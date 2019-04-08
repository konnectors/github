const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')

const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})
const moment = require('moment')

const VENDOR = 'Github'
const baseUrl = 'https://github.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const billingHistoryPath = fields.organization
    ? `/organizations/${fields.organization}/billing/history`
    : '/account/billing/history'
  const $ = await request(`${baseUrl}${billingHistoryPath}`)
  log('info', 'Parsing list of documents')
  const succeededBills = await parseBills($, '.payment-history .succeeded')
  const refundedBills = await parseBills($, '.payment-history .refunded')
  const bills = [].concat(succeededBills, refundedBills)

  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields, {
    identifiers: ['github', 'github.com'],
    contentType: 'application/pdf'
  })
}

function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/login`,
    formSelector: 'form',
    formData: {
      login: username,
      password: password
    },
    validate: (statusCode, $, fullResponse) => {
      log('info', `Login status code is: ${statusCode}`)
      log('info', fullResponse.request.uri.href)
      return fullResponse.request.uri.href === 'https://github.com/'
    }
  })
}

function parseBills($, selector) {
  const bills = scrape(
    $,
    {
      id: {
        sel: 'td.id code'
      },
      moment: {
        sel: 'td.date time',
        attr: 'title',
        parse: date => moment(date, 'YYYY-MM-DD HH:mm:ss')
      },
      amount: {
        sel: 'td.amount',
        parse: amount => parseFloat(amount.replace('$', '').trim())
      },
      fileurl: {
        sel: 'td.receipt a',
        attr: 'href',
        parse: href => `${baseUrl}${href}`
      }
    },
    selector
  )
  return bills.map(bill => ({
    ...bill,
    date: bill.moment.toDate(),
    currency: '$',
    filename: `${bill.moment.format(
      'YYYY-MM-DD_HH:mm:ss'
    )}_${VENDOR}_$${bill.amount.toFixed(2)}.pdf`,
    vendor: VENDOR,
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}
