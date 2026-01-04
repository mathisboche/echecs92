(() => {
  const form = document.getElementById('cdje92-contact-form');
  if (!form) {
    return;
  }

  const captchaField = form.querySelector('[data-recaptcha-field]');
  const captchaEl = captchaField ? captchaField.querySelector('.g-recaptcha') : null;
  const siteKey = captchaEl && captchaEl.dataset ? (captchaEl.dataset.sitekey || '').trim() : '';
  const messageEl = captchaField ? captchaField.querySelector('[data-recaptcha-message]') : null;
  const submitButton = form.querySelector('.contact-form__submit');

  const ensureMessageEl = () => {
    if (messageEl) {
      return messageEl;
    }
    const hint = document.createElement('p');
    hint.className = 'contact-form__hint contact-form__captcha-message';
    hint.setAttribute('data-recaptcha-message', '');
    if (submitButton && submitButton.parentNode) {
      submitButton.parentNode.insertBefore(hint, submitButton.nextSibling);
    } else {
      form.appendChild(hint);
    }
    return hint;
  };

  if (!captchaField || !captchaEl || !siteKey) {
    const hint = ensureMessageEl();
    hint.textContent = 'Verification anti-robot indisponible. Envoi impossible.';
    if (submitButton) {
      submitButton.disabled = true;
    }
    return;
  }

  let widgetId = null;
  let scriptPromise = null;
  let pendingSubmit = false;

  const setMessage = (text) => {
    const hint = ensureMessageEl();
    hint.textContent = text || '';
  };

  const showCaptcha = () => {
    if (captchaField.hasAttribute('hidden')) {
      captchaField.removeAttribute('hidden');
    }
    captchaField.setAttribute('aria-hidden', 'false');
  };

  const loadRecaptchaScript = () => {
    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      return Promise.resolve();
    }
    if (scriptPromise) {
      return scriptPromise;
    }

    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?hl=fr&render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('recaptcha_load_failed'));
      document.head.appendChild(script);
    });

    return scriptPromise;
  };

  const renderRecaptcha = () => {
    if (widgetId !== null) {
      return;
    }

    const doRender = () => {
      if (widgetId !== null) {
        return;
      }
      if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function') {
        return;
      }

      widgetId = window.grecaptcha.render(captchaEl, {
        sitekey: siteKey,
        callback: () => {
          setMessage('');
          if (pendingSubmit) {
            pendingSubmit = false;
            form.submit();
          }
        },
        'expired-callback': () => {
          pendingSubmit = false;
        },
      });
    };

    if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
      window.grecaptcha.ready(() => {
        requestAnimationFrame(doRender);
      });
      return;
    }

    requestAnimationFrame(doRender);
  };

  form.addEventListener('submit', (event) => {
    if (!window.grecaptcha || widgetId === null) {
      event.preventDefault();
      pendingSubmit = true;
      showCaptcha();
      setMessage("Merci de confirmer que vous n'etes pas un robot pour envoyer.");
      loadRecaptchaScript()
        .then(() => {
          renderRecaptcha();
        })
        .catch(() => {
          pendingSubmit = false;
          setMessage("Le captcha n'a pas pu etre charge. Envoi impossible pour le moment.");
        });
      return;
    }

    const response = window.grecaptcha.getResponse(widgetId);
    if (!response) {
      event.preventDefault();
      pendingSubmit = true;
      showCaptcha();
      setMessage("Merci de confirmer que vous n'etes pas un robot pour envoyer.");
    }
  });
})();
