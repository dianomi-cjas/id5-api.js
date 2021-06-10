/** @module id5-api */

import {
  setGlobalDebug,
  isGlobalDebug,
  logInfo,
  logError,
  isBoolean,
  ajax,
  isStr,
  deferPixelFire } from './utils';
import { getRefererInfo } from './refererDetection';
import ClientStore from './clientStore';
import ConsentManagement from './consentManagement';
import Id5Status from './id5Status';
import { version as currentVersion } from '../generated/version.js';
import LocalStorage from './localStorage.js';

class Id5Api {
  /** @type {boolean} */
  loaded = false;
  /** @type {boolean} */
  set debug(isDebug) {
    setGlobalDebug(isDebug);
  }
  get debug() {
    return isGlobalDebug();
  }
  /** @type {boolean} */
  debugBypassConsent = false;
  /** @type {boolean} */
  allowLocalStorageWithoutConsentApi = false;
  /** @type {boolean} */
  localStorageAllowed = false;
  /** @type {boolean} */
  isUsingCdn = false;
  /** @type {object} */
  referer = false;
  /** @type {string} */
  version = currentVersion;
  /** @type {object} */
  versions = {};
  /** @type {LocalStorage} */
  localStorage;

  constructor() {
    this.loaded = true;
    this.isUsingCdn = !!(
      document &&
      document.currentScript &&
      document.currentScript.src &&
      document.currentScript.src.indexOf('https://cdn.id5-sync.com') === 0
    );
    this.referer = getRefererInfo();
    const currentThis = this; // preserve this in callback
    this.versions[currentVersion] = true;

    // By using window.top we say we want to use storage only if we're in a first-party context
    this.localStorage = new LocalStorage(window.top);

    this.clientStore = new ClientStore(() => {
      return currentThis.localStorageAllowed;
    }, this.localStorage);
  }

  /**
   * This function will initialize ID5, wait for consent then try to fetch or refresh ID5 user id if required
   * @param {Id5Options} options
   * @return {Id5Status} Status of the ID5 API for this caller, for further interactions
   */
  init(options) {
    if (typeof this.version === 'undefined') {
      throw new Error('ID5.version variable is missing! Make sure you build from source with "gulp build" from this project. Contact support@id5.io for help.');
    }

    try {
      logInfo('Invoking Id5Api.init', arguments);
      const partnerStatus = new Id5Status(options);
      this.debugBypassConsent = this.debugBypassConsent || partnerStatus.getOptions().debugBypassConsent;
      this.allowLocalStorageWithoutConsentApi = this.allowLocalStorageWithoutConsentApi || partnerStatus.getOptions().allowLocalStorageWithoutConsentApi;
      this.consent = new ConsentManagement(this.localStorage);
      this.getId(partnerStatus, false);
      logInfo(`ID5 initialized for partner ${partnerStatus.getOptions().partnerId} with referer ${this.referer.referer} and options`, options);
      return partnerStatus;
    } catch (e) {
      logError('Exception caught from Id5Api.init', e);
    }
  };

  /** @param {Id5Status} id5Status - Initializes id5Status returned by `init()`
   * @param {boolean} forceFetch
   * @param {Id5Options} [options] - Options to update
   * @return {Id5Status} provided id5Status for chaining
   */
  refreshId(id5Status, forceFetch = false, options = {}) {
    if (typeof this.version === 'undefined') {
      throw new Error('ID5.version variable is missing! Make sure you build from source with "gulp build" from this project. Contact support@id5.io for help.');
    }
    if (!isBoolean(forceFetch)) {
      throw new Error('Invalid signature for Id5Api.refreshId: second parameter must be a boolean');
    }

    try {
      logInfo('Invoking Id5Api.refreshId', arguments);
      id5Status.startRefresh(forceFetch);
      id5Status.updateOptions(options);
      this.consent.resetConsentData();
      this.getId(id5Status, forceFetch);
    } catch (e) {
      logError('Exception caught from Id5Api.refreshId', e);
    }
    return id5Status;
  };

  updateLocalStorageAllowed() {
    this.localStorageAllowed = this.consent.isLocalStorageAllowed(this.allowLocalStorageWithoutConsentApi, this.debugBypassConsent);
  }

  /**
   * This function get the user ID for the given config
   * @param {Id5Status} id5Status
   * @param {boolean} forceFetch - Force a call to server
   */
  getId(id5Status, forceFetch = false) {
    const options = id5Status.getOptions();
    let storedResponse;
    let storedDateTime;
    let nb = 0;
    let refreshInSecondsHasElapsed = false;
    let pdHasChanged = false;
    let cachedResponseUsed = false;

    this.updateLocalStorageAllowed();
    if (this.localStorageAllowed) {
      storedResponse = this.clientStore.getResponse();
      storedDateTime = this.clientStore.getDateTime();
      refreshInSecondsHasElapsed = storedDateTime <= 0 || ((Date.now() - storedDateTime) > (options.refreshInSeconds * 1000));
      nb = this.clientStore.getNb(options.partnerId);
      pdHasChanged = !this.clientStore.storedPdMatchesPd(options.partnerId, options.pd);
    }

    if (!storedResponse) {
      storedResponse = this.clientStore.getResponseFromLegacyCookie();
      refreshInSecondsHasElapsed = true; // Force a refresh if we have legacy cookie
    }

    if (storedResponse && storedResponse.universal_uid && !pdHasChanged) {
      // we have a valid stored response and pd is not different, so
      // use the stored response to make the ID available right away

      id5Status.setUserId(storedResponse.universal_uid, storedResponse.link_type || 0, true);
      nb = this.clientStore.incNb(options.partnerId, nb);
      cachedResponseUsed = true;

      logInfo('ID5 User ID available from cache:', {
        storedResponse,
        storedDateTime,
        refreshNeeded: refreshInSecondsHasElapsed
      });
    } else if (storedResponse && storedResponse.universal_uid && pdHasChanged) {
      logInfo('PD value has changed, so ignoring User ID from cache');
    } else if (storedResponse && !storedResponse.universal_uid) {
      logError('Invalid stored response: ', storedResponse);
    } else {
      logInfo('No ID5 User ID available from cache');
    }

    this.consent.requestConsent(this.debugBypassConsent, options.cmpApi, options.consentData, (consentData) => {
      // re-evaluate local storage access as consent is now available
      this.updateLocalStorageAllowed();
      if (this.localStorageAllowed !== false) {
        logInfo('Consent to access local storage is given: ', this.localStorageAllowed);

        storedResponse = this.clientStore.getResponse() || this.clientStore.getResponseFromLegacyCookie();

        // store hashed consent data and pd for future page loads
        const consentHasChanged = !this.clientStore.storedConsentDataMatchesConsentData(consentData);
        this.clientStore.putHashedConsentData(consentData);
        this.clientStore.putHashedPd(options.partnerId, options.pd);

        // make a call to fetch a new ID5 ID if:
        // - there is no valid universal_uid or no signature in cache
        // - the last refresh was longer than refreshInSeconds ago
        // - consent has changed since the last ID was fetched
        // - pd has changed since the last ID was fetched
        // - fetch is being forced (e.g. by refreshId())
        if (
          !storedResponse || !storedResponse.universal_uid || !storedResponse.signature ||
          refreshInSecondsHasElapsed ||
          consentHasChanged ||
          pdHasChanged ||
          forceFetch
        ) {
          const url = `https://id5-sync.com/g/v2/${options.partnerId}.json`;
          const gdprApplies = (consentData && consentData.gdprApplies) ? 1 : 0;
          const gdprConsentString = (consentData && consentData.gdprApplies) ? consentData.consentString : undefined;
          const signature = (storedResponse && storedResponse.signature) ? storedResponse.signature : undefined;
          const data = {
            'partner': options.partnerId,
            'v': this.version,
            'o': 'api',
            'gdpr': gdprApplies,
            'rf': this.referer.referer,
            'u': this.referer.stack[0] || window.location.href,
            'top': this.referer.reachedTop ? 1 : 0,
            'localStorage': this.localStorage.isAvailable() ? 1 : 0,
            'nbPage': nb,
            'id5cdn': this.isUsingCdn
          };

          // pass in optional data, but only if populated
          if (typeof gdprConsentString !== 'undefined') {
            data.gdpr_consent = gdprConsentString;
          }
          if (typeof signature !== 'undefined') {
            data.s = signature;
          }
          if (typeof options.pd !== 'undefined') {
            data.pd = options.pd;
          }
          if (typeof options.partnerUserId !== 'undefined') {
            data.puid = options.partnerUserId;
          }
          if (typeof options.provider !== 'undefined') {
            data.provider = options.provider;
          }

          // pass in feature flags, if applicable
          if (id5Status.getOptions().abTesting.enabled === true) {
            data.features = data.features || {};
            data.features.ab = 1;
          }

          logInfo('Fetching ID5 user ID from:', url, data);
          if (forceFetch) {
            logInfo('...with Force Fetch');
          }
          ajax(url, {
            success: response => {
              logInfo('Response from ID5 received:', response);
              let responseObj;
              if (response) {
                try {
                  responseObj = JSON.parse(response);
                  logInfo('Valid json response from ID5 received:', responseObj);
                  if (isStr(responseObj.universal_uid)) {
                    id5Status.setUserId(responseObj.universal_uid, responseObj.link_type || 0, false);

                    // privacy has to be stored first so we can use it when storing other values
                    this.consent.setStoredPrivacy(responseObj.privacy);
                    // re-evaluate local storage access as geo is now available
                    this.updateLocalStorageAllowed();

                    // @TODO: typeof responseObj.privacy === 'undefined' is only needed until fetch endpoint is updated and always returns a privacy object
                    // once it does, I don't see a reason to keep that part of the if clause
                    if (this.localStorageAllowed === true || typeof responseObj.privacy === 'undefined') {
                      this.clientStore.putResponse(response);
                      this.clientStore.setDateTime(new Date().toUTCString());
                      this.clientStore.setNb(options.partnerId, (cachedResponseUsed ? 0 : 1));
                    } else {
                      this.clientStore.clearAll(options.partnerId);
                    }
                    // TEMPORARY until all clients have upgraded past v1.0.0
                    // remove cookies that were previously set
                    this.clientStore.removeLegacyCookies(options.partnerId);

                    if (responseObj.cascade_needed === true && this.localStorageAllowed === true && options.maxCascades >= 0) {
                      const isSync = options.partnerUserId && options.partnerUserId.length > 0;
                      const syncUrl = `https://id5-sync.com/${isSync ? 's' : 'i'}/${options.partnerId}/${options.maxCascades}.gif?id5id=${id5Status._userId}&o=api&${isSync ? 'puid=' + options.partnerUserId + '&' : ''}gdpr_consent=${gdprConsentString}&gdpr=${gdprApplies}`;
                      logInfo('Opportunities to cascade available:', syncUrl);
                      deferPixelFire(syncUrl);
                    }
                  } else {
                    logError('Invalid response from ID5 servers:', response);
                  }
                } catch (error) {
                  logError(error);
                }
              } else {
                logError('Empty response from ID5 servers:', response);
              }
            },
            error: error => {
              logError(error);
            }
          }, JSON.stringify(data), {method: 'POST', withCredentials: true});
        }
      } else {
        logInfo('No legal basis to use ID5', consentData);
      }
    });
  }
}

const ID5 = new Id5Api();
export default ID5;