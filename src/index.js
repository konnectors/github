const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log,
  utils
} = require('cozy-konnector-libs')
const request = requestFactory({
  // The debug mode shows all the details about HTTP requests and responses. Very useful for
  // debugging but very verbose. This is why it is commented out by default
  // debug: true,
  // Activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // This allows request-promise to keep cookies between requests
  jar: true
})

const VENDOR = 'github'
const baseUrl = 'https://github.com'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/account/billing/history`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)
  console.log(documents)

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  /* TODO
  await saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['books']
  })
  */
}

// This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/login`,
    formSelector: 'form',
    formData: { 
      "login": username, 
      "password": password 
    },
    // The validate function will check if the login request was a success. Every website has a
    // different way to respond: HTTP status code, error message in HTML ($), HTTP redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $, fullResponse) => {
      log('info', `Login status code is: ${statusCode}`)
      log(
        'info',
        fullResponse.request.uri.href
      
      )
      return fullResponse.request.uri.href === 'https://github.com/';
    }
  })
}

// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $,
    {
      title: {
        sel: 'td.id code'
      },
      amount: {
        sel: 'td.amount',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'td.receipt a',
        attr: 'href',
        parse: href => `${baseUrl}${href}`
      }
    },
    '.payment-history .succeeded'
  )
  return docs
  /*
  return docs.map(doc => ({
    ...doc,
    // The saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: new Date(),
    currency: '€',
    filename: `${utils.formatDate(new Date())}_${VENDOR}_${doc.amount.toFixed(
      2
    )}€${doc.vendorRef ? '_' + doc.vendorRef : ''}.jpg`,
    vendor: VENDOR,
    metadata: {
      // It can be interesting to add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: new Date(),
      // Document version, useful for migration after change of document structure
      version: 1
    }
  }))
  */
}

// Convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('$', '').trim())
}
