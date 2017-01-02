import Symbol from 'poor-mans-symbol';

const OFI = Symbol('OFI');
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

function fixOne(el, requestedSrc) {
	if (el[OFI].parsingSrcset) {
		return;
	}
	const style = getStyle(el);
	style['object-fit'] = style['object-fit'] || 'fill'; // default value

	// If the fix was already applied, don't try to skip fixing,
	// - because once you go ofi you never go back.
	// - Wait, that doesn't rhyme.
	// - This ain't rap, bro.
	if (!el[OFI].s) {
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

	let src = el[OFI].ios7src || el.currentSrc || el.src;

	if (requestedSrc) {
		// explicitly requested src takes precedence
		// TODO: this still should overwrite srcset
		src = requestedSrc;
	} else if (el.srcset && !supportsCurrentSrc && window.picturefill) {
		const pf = window.picturefill._;
		// prevent infinite loop
		// fillImg sets the src which in turn calls fixOne
		el[OFI].parsingSrcset = true;

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
		delete el[OFI].parsingSrcset;

		// retrieve parsed currentSrc, if any
		src = el[pf.ns].curSrc || src;
	}

	// store info on object for later use
	if (el[OFI].s) {
		el[OFI].s = src;
		if (requestedSrc) {
			// the attribute reflects the user input
			// the property is the resolved URL
			el[OFI].srcAttr = requestedSrc;
		}
	} else {
		el[OFI] = {
			s: src,
			srcAttr: requestedSrc || nativeGetAttribute.call(el, 'src'),
			srcsetAttr: el.srcset
		};

		setPlaceholder(el, el.width, el.height);

		try {
			// remove srcset because it overrides src
			if (el.srcset) {
				el.srcset = '';

				// restore non-browser-readable srcset property
				Object.defineProperty(el, 'srcset', {
					value: el[OFI].srcsetAttr
				});
			}

			keepSrcUsable(el);
		} catch (err) {
			el[OFI].ios7src = src;
		}
	}

	el.style.backgroundImage = 'url("' + src.replace('(', '%28').replace(')', '%29') + '")';
	el.style.backgroundPosition = style['object-position'] || 'center';
	el.style.backgroundRepeat = 'no-repeat';

	if (/scale-down/.test(style['object-fit'])) {
		// `object-fit: scale-down` is either `contain` or `auto`
		if (!el[OFI].i) {
			el[OFI].i = new Image();
			el[OFI].i.src = src;
		}

		onImageReady(el[OFI].i, testingImage => {
			if (testingImage.naturalWidth > el.width || testingImage.naturalHeight > el.height) {
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
		get() {
			return el[OFI].s;
		},
		set(src) {
			delete el[OFI].i; // scale-down's img sizes need to be updated too
			fixOne(el, src);
			return src;
		}
	};
	Object.defineProperty(el, 'src', descriptors);
	Object.defineProperty(el, 'currentSrc', {get: descriptors.get}); // it should be read-only
}

function hijackAttributes() {
	if (!supportsObjectPosition) {
		HTMLImageElement.prototype.getAttribute = function (name) {
			if (this[OFI] && (name === 'src' || name === 'srcset')) {
				return this[OFI][name + 'Attr'];
			}
			return nativeGetAttribute.call(this, name);
		};

		HTMLImageElement.prototype.setAttribute = function (name, value) {
			if (this[OFI] && (name === 'src' || name === 'srcset')) {
				this[name === 'src' ? 'src' : name + 'Attr'] = String(value);
			} else {
				nativeSetAttribute.call(this, name, value);
			}
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
		imgs[i][OFI] = imgs[i][OFI] || opts;
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
