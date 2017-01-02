const OFI = 'bfred-it:object-fit-images';
const propRegex = /(object-fit|object-position)\s*:\s*([-\w\s%]+)/g;
const testImg = new Image();
const placeholder = document.createElement('canvas');
const supportsObjectFit = 'object-fit' in testImg.style;
const supportsObjectPosition = 'object-position' in testImg.style;
const supportsOFI = 'background-size' in testImg.style && window.HTMLCanvasElement;
const supportsCurrentSrc = typeof testImg.currentSrc === 'string';
const nativeGetAttribute = testImg.getAttribute;
const nativeSetAttribute = testImg.setAttribute;
let autoModeEnabled = false;

function polyfillCurrentSrc(el) {
	if (el.srcset && !supportsCurrentSrc && window.picturefill) {
		const pf = window.picturefill._;
		// parse srcset with picturefill where currentSrc isn't available
		if (!el[pf.ns] || !el[pf.ns].evaled) {
			// force synchronous srcset parsing
			pf.fillImg(el, {reselect: true});
		}

		if (!el[pf.ns].curSrc) {
			// force picturefill to parse srcset
			el[pf.ns].supported = false;
			pf.fillImg(el, {reselect: true});
		}

		// retrieve parsed currentSrc, if any
		el.currentSrc = el[pf.ns].curSrc || el.src;
	}
}

function getStyle(el) {
	const style = getComputedStyle(el).fontFamily;
	let parsed;
	const props = {};
	while ((parsed = propRegex.exec(style)) !== null) {
		props[parsed[1]] = parsed[2];
	}
	return props;
}

function setPlaceholder(img, width, height) {
	placeholder.width = width || 1;
	placeholder.height = height || 1;
	if (img[OFI].width !== placeholder.width || img[OFI].height !== placeholder.height) {
		img[OFI].width = placeholder.width;
		img[OFI].height = placeholder.height;
		img.src = placeholder.toDataURL();
	}
}

function onImageReady(img, callback) {
	// naturalWidth is only available when the image headers are loaded,
	// this loop will poll it every 100ms.
	if (img.naturalWidth) {
		callback(img);
	} else {
		setTimeout(onImageReady, 100, img, callback);
	}
}

function fixOne(el) {
	const style = getStyle(el);
	style['object-fit'] = style['object-fit'] || 'fill'; // default value

	// Avoid running where unnecessary, unless OFI had already done its deed
	if (!el[OFI].img) {
		// fill is the default behavior so no action is necessary
		if (style['object-fit'] === 'fill') {
			return;
		}

		// Where object-fit is supported and object-position isn't (Safari < 10)
		if (
			!el[OFI].skipTest && // unless user wants to apply regardless of browser support
			supportsObjectFit && // if browser already supports object-fit
			!style['object-position'] // unless object-position is used
		) {
			return;
		}
	}

	// keep a clone in memory while resetting the original to a blank
	let realImage = el[OFI].img;
	if (!realImage) {
		realImage = new Image(el.width, el.height);
		realImage.srcset = el.srcset;
		realImage.src = el.src;
	}

	polyfillCurrentSrc(realImage);

	if (!el[OFI].img) {
		el[OFI].img = realImage;

		setPlaceholder(el, el.width, el.height);

		try {
			// remove srcset because it overrides src
			if (el.srcset) {
				el.srcset = '';

				// restore non-browser-readable srcset property
				Object.defineProperty(el, 'srcset', {
					value: el[OFI].img.srcset
				});
			}

			keepSrcUsable(el);
		} catch (err) {
			if (window.console) {
				console.log('http://bit.ly/ofi-old-browser');
			}
		}
	}

	el.style.backgroundImage = `url(${(realImage.currentSrc || realImage.src).replace('(', '%28').replace(')', '%29')})`;
	el.style.backgroundPosition = style['object-position'] || 'center';
	el.style.backgroundRepeat = 'no-repeat';

	if (/scale-down/.test(style['object-fit'])) {
		onImageReady(realImage, () => {
			if (realImage.naturalWidth > el.width || realImage.naturalHeight > el.height) {
				el.style.backgroundSize = 'contain';
			} else {
				el.style.backgroundSize = 'auto';
			}
		});
	} else {
		el.style.backgroundSize = style['object-fit'].replace('none', 'auto').replace('fill', '100% 100%');
	}
}

function keepSrcUsable(el) {
	const descriptors = {
		get(prop) {
			return el[OFI].img[prop ? prop : 'src'];
		},
		set(src) {
			el[OFI].img.src = src;
			fixOne(el);
			return src;
		}
	};
	Object.defineProperty(el, 'src', descriptors);
	Object.defineProperty(el, 'currentSrc', {get: () => descriptors.get('currentSrc')});
}

function hijackAttributes() {
	function getOfiImageMaybe(el, name) {
		return el[OFI] && (name === 'src' || name === 'srcset') ? el[OFI].img : el;
	}
	if (!supportsObjectPosition) {
		HTMLImageElement.prototype.getAttribute = function (name) {
			return nativeGetAttribute.call(getOfiImageMaybe(this, name), name);
		};

		HTMLImageElement.prototype.setAttribute = function (name, value) {
			return nativeSetAttribute.call(getOfiImageMaybe(this, name), name, String(value));
		};
	}
}

export default function fix(imgs, opts) {
	const startAutoMode = !autoModeEnabled && !imgs;
	opts = opts || {};
	imgs = imgs || 'img';
	if ((supportsObjectPosition && !opts.skipTest) || !supportsOFI) {
		return false;
	}

	// use imgs as a selector or just select all images
	if (typeof imgs === 'string') {
		imgs = document.querySelectorAll('img');
	} else if (!('length' in imgs)) {
		imgs = [imgs];
	}

	// apply fix to all
	for (let i = 0; i < imgs.length; i++) {
		imgs[i][OFI] = imgs[i][OFI] || {
			skipTest: opts.skipTest
		};
		fixOne(imgs[i]);
	}

	if (startAutoMode) {
		document.body.addEventListener('load', e => {
			if (e.target.tagName === 'IMG') {
				fix(e.target, {
					skipTest: opts.skipTest
				});
			}
		}, true);
		autoModeEnabled = true;
		imgs = 'img'; // reset to a generic selector for watchMQ
	}

	// if requested, watch media queries for object-fit change
	if (opts.watchMQ) {
		window.addEventListener('resize', fix.bind(null, imgs, {
			skipTest: opts.skipTest
		}));
	}
}

fix.supportsObjectFit = supportsObjectFit;
fix.supportsObjectPosition = supportsObjectPosition;

hijackAttributes();
