/*
 * Module for getting and setting ID5 API configuration.
 */

const utils = require('./utils');

/**
 * @typedef {Object} Id5Config
 * @property {boolean|false} debug - enable verbose debug mode (defaulting to id5_debug query string param if present, or false)
 * @property {boolean|false} allowID5WithoutConsentApi - Allow ID5 to fetch user id even if no consent API
 * @property {(string|undefined)} cookieName - ID5 1st party cookie name (defaulting to id5.1st)
 * @property {(number|undefined)} refreshInSeconds - Refresh period of first-party cookie (defaulting to 7200s)
 * @property {(number|undefined)} cookieExpirationInSeconds - Expiration of 1st party cookie (defaulting to 90 days)
 * @property {(number)} partnerId - ID5 Publisher ID, mandatory
 * @property {(string|undefined)} partnerUserId - User ID for the publisher, to be stored by ID5 for further matching if provided
 * @property {(string|undefined)} cmpApi - API to use CMP. As of today, either 'iab' or 'static'
 * @property {(object|undefined)} consentData - Consent data if cmpApi is 'static'
 * @property {(function|undefined)} callback - Function to call back when User ID is available. if callbackTimeoutInMs is not provided, will be fired only if a User ID is available.
 * @property {(number|undefined)} callbackTimeoutInMs - Delay in ms after which the callback is guaranteed to be fired. A User ID may not yet be available at this time.
 * @property {(string|undefined)} pd - Publisher data to help ID5 link IDs across domains. See details on generating the value in the README
 * @property {(string|undefined)} customHostname - Change the hostname for calls to the ID5 servers
 * @property {(boolean|true)} autoSwitchHostname - Allow the API to detect when the customHost should be used vs the standard ID5 host for improved cross-domain reconciliation
 */

export function newConfig() {
  /**
   * @property {Id5Config}
   */
  let config;

  const configTypes = {
    debug: 'Boolean',
    allowID5WithoutConsentApi: 'Boolean',
    cmpApi: 'String',
    consentData: 'Object',
    cookieName: 'String',
    refreshInSeconds: 'Number',
    cookieExpirationInSeconds: 'Number',
    partnerId: 'Number',
    partnerUserId: 'String',
    callback: 'Function',
    callbackTimeoutInMs: 'Number',
    pd: 'String',
    customHostname: 'String',
    autoSwitchHostname: 'Boolean'
  };

  function resetConfig() {
    config = {
      debug: utils.getParameterByName('id5_debug').toUpperCase() === 'TRUE',
      allowID5WithoutConsentApi: false,
      cmpApi: 'iab',
      consentData: {
        getConsentData: {
          consentData: undefined,
          gdprApplies: undefined
        },
        getVendorConsents: {},
        getTCData: undefined
      },
      cookieName: 'id5id.1st',
      refreshInSeconds: 7200,
      cookieExpirationInSeconds: 90 * 24 * 60 * 60,
      partnerId: undefined,
      partnerUserId: undefined,
      callback: undefined,
      callbackTimeoutInMs: undefined,
      pd: '',
      customHostname: '',
      autoSwitchHostname: true
    };
  }

  /**
   * Return current configuration
   * @returns {Id5Config} options
   */
  function getConfig() {
    return config;
  }

  /**
   * Sets configuration given an object containing key-value pairs
   * @param {Id5Config} options
   * @returns {Id5Config} options
   */
  function setConfig(options) {
    if (typeof options !== 'object') {
      utils.logError('setConfig options must be an object');
      return undefined;
    }

    Object.keys(options).forEach(topic => {
      if (utils.isA(options[topic], configTypes[topic])) {
        config[topic] = options[topic];
      } else {
        utils.logError(`setConfig options ${topic} must be of type ${configTypes[topic]} but was ${toString.call(options[topic])}`);
      }
    });
    return config
  }

  resetConfig();

  return {
    getConfig,
    setConfig,
    resetConfig
  };
}

export const config = newConfig();
