(() => {
  const form = document.getElementById('cdje92-contact-form');
  if (!form) {
    return;
  }

  const captchaField = form.querySelector('[data-recaptcha-field]');
  const captchaEl = captchaField ? captchaField.querySelector('.g-recaptcha') : null;
  const siteKey = captchaEl && captchaEl.dataset ? (captchaEl.dataset.sitekey || '').trim() : '';
  const messageEl = captchaField ? captchaField.querySelector('[data-recaptcha-message]') : null;

  if (!captchaField || !captchaEl || !siteKey) {
    return;
  }

  let widgetId = null;
  let scriptPromise = null;
  let pendingSubmit = false;

  const setMessage = (text) => {
    if (messageEl) {
      messageEl.textContent = text || '';
    }
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
          setMessage("Le captcha n'a pas pu etre charge. Merci de reessayer.");
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
