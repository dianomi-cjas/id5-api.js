/**
 * The referer detection module attempts to gather referer information from the current page that id5-api.js resides in.
 * The information that it tries to collect includes:
 * The detected top url in the nav bar,
 * Whether it was able to reach the top most window (if for example it was embedded in several iframes),
 * The number of iframes it was embedded in if applicable,
 * A list of the domains of each embedded window if applicable.
 * Canonical URL which refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
 */

export function detectReferer(win) {
  /**
   * Returns number of frames to reach top from current frame
   * @returns {Array} levels
   */
  function getLevels() {
    let levels = walkUpWindows();
    let ancestors = getAncestorOrigins();

    if (ancestors) {
      for (let i = 0, l = ancestors.length; i < l; i++) {
        levels[i].ancestor = ancestors[i];
      }
    }
    return levels;
  }

  /**
   * This function would return a read-only array of hostnames for all the parent frames.
   * win.location.ancestorOrigins is only supported in webkit browsers. For non-webkit browsers it will return undefined.
   * @returns {(undefined|Array)} Ancestor origins or undefined
   */
  function getAncestorOrigins() {
    try {
      if (!win.location.ancestorOrigins) {
        return;
      }
      return win.location.ancestorOrigins;
    } catch (e) {
      // Ignore error
    }
  }

  /**
   * This function would try to get referer and urls for all parent frames in case of win.location.ancestorOrigins undefined.
   * @param {Array} levels
   * @returns {Object} urls for all parent frames and top most detected referer url
   */
  function getPubUrlStack(levels) {
    let stack = [];
    let defUrl = null;
    let frameLocation = null;
    let prevFrame = null;
    let prevRef = null;
    let ancestor = null;
    let detectedRefererUrl = null;

    let i;
    for (i = levels.length - 1; i >= 0; i--) {
      try {
        frameLocation = levels[i].location;
      } catch (e) {
        // Ignore error
      }

      if (frameLocation) {
        stack.push(frameLocation);
        if (!detectedRefererUrl) {
          detectedRefererUrl = frameLocation;
        }
      } else if (i !== 0) {
        prevFrame = levels[i - 1];
        try {
          prevRef = prevFrame.referrer;
          ancestor = prevFrame.ancestor;
        } catch (e) {
          // Ignore error
        }

        if (prevRef) {
          stack.push(prevRef);
          if (!detectedRefererUrl) {
            detectedRefererUrl = prevRef;
          }
        } else if (ancestor) {
          stack.push(ancestor);
          if (!detectedRefererUrl) {
            detectedRefererUrl = ancestor;
          }
        } else {
          stack.push(defUrl);
        }
      } else {
        stack.push(defUrl);
      }
    }
    return {
      stack,
      detectedRefererUrl
    };
  }

  /**
   * This function returns canonical URL which refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
   * @param {Object} doc document
   */
  function getCanonicalUrl(doc) {
    try {
      let element = doc.querySelector("link[rel='canonical']");
      if (element !== null) {
        return element.href;
      }
    } catch (e) {
    }
    return null;
  }

  /**
   * Walk up to the top of the window to detect origin, number of iframes, ancestor origins and canonical url
   */
  function walkUpWindows() {
    let acc = [];
    let currentWindow;
    do {
      try {
        currentWindow = currentWindow ? currentWindow.parent : win;
        try {
          let isTop = (currentWindow === win.top);
          let refData = {
            referrer: currentWindow.document.referrer || null,
            location: currentWindow.location.href || null,
            isTop
          };
          if (isTop) {
            refData = Object.assign(refData, {
              canonicalUrl: getCanonicalUrl(currentWindow.document)
            });
          }
          acc.push(refData);
        } catch (e) {
          acc.push({
            referrer: null,
            location: null,
            isTop: (currentWindow === win.top)
          });
        }
      } catch (e) {
        acc.push({
          referrer: null,
          location: null,
          isTop: false
        });
        return acc;
      }
    } while (currentWindow !== win.top);
    return acc;
  }

  /**
   * Referer info
   * @typedef {Object} refererInfo
   * @property {string} topmostLocation - detected top url
   * @property {string|null} ref the referrer (document.referrer) to the current page, or null if not available (due to cross-origin restrictions)
   * @property {boolean} reachedTop - whether it was possible to walk upto top window or not
   * @property {number} numIframes - number of iframes
   * @property {string} stack - comma separated urls of all origins
   * @property {string} canonicalUrl - canonical URL refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
   */

  /**
   * Get referer info
   * @returns {refererInfo}
   */
  function refererInfo() {
    try {
      let levels = getLevels();
      let numIframes = levels.length - 1;
      let reachedTop = (levels[numIframes].location !== null ||
        (numIframes > 0 && levels[numIframes - 1].referrer !== null));
      let stackInfo = getPubUrlStack(levels);
      let canonicalUrl;
      let ref;
      if (levels[levels.length - 1].canonicalUrl) {
        canonicalUrl = levels[levels.length - 1].canonicalUrl;
      }
      try {
        ref = win.top.document.referrer;
      } catch (e) {}
      return {
        topmostLocation: stackInfo.detectedRefererUrl,
        ref: ref || null,
        reachedTop,
        numIframes,
        stack: stackInfo.stack,
        canonicalUrl
      };
    } catch (e) {
      // Ignore error
    }
  }

  return refererInfo;
}

export const getRefererInfo = detectReferer(window);
