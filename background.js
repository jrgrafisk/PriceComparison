// background.js for Firefox (using browser.runtime.onMessage)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'findPrice') {
    const gtin = message.gtin;
    const url = message.url;

    fetch(url)
      .then(response => response.text())
      .then(html => {
        sendResponse({ html, url });  // Send the raw HTML and URL back
      })
      .catch(error => {
        console.error(`Error fetching data from ${url}:`, error);
        sendResponse({ html: null, url });  // Send null HTML and the URL in case of error
      });

    // Return true to indicate response will be asynchronous
    return true;
  }
});
