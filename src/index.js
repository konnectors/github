process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://33a142994ff042268d35af26f5238820@sentry.cozycloud.cc/121'

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
  const billingHistoryPath = (await checkOrga(fields))
    ? `/organizations/${fields.organization}/billing/history`
    : '/account/billing/history'
  const $ = await request(`${baseUrl}${billingHistoryPath}`)
  log('info', 'Parsing list of documents')
  const succeededBills = await parseBills($, '.payment-history .succeeded')
  const refundedBills = await parseBills($, '.payment-history .refunded')
  const bills = [].concat(succeededBills, refundedBills)

  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields, {
    identifiers: ['github.com'],
    contentType: 'application/pdf'
  })
}

async function checkOrga({ login, organization }) {
  if (!organization) return true

  log(
    'info',
    'Checking if the specified organization is accessible with this account'
  )
  const $ = await request(`${baseUrl}/${login}`)
  const orgas = Array.from(
    $('a[data-hovercard-type=organization][itemprop=follows]')
  ).map(el =>
    $(el)
      .attr('href')
      .slice(1)
  )
  const result = orgas.includes(organization)

  if (!result)
    log(
      'warn',
      `Could not find the ${organization} organization, using the default billing address`
    )
  return result
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
      date: {
        sel: 'td.date time',
        attr: 'title',
        parse: date => moment(date, 'YYYY-MM-DD HH:mm:ss').toDate()
      },
      amount: {
        sel: 'td.amount',
        parse: amount =>
          parseFloat(
            amount
              .replace('$', '')
              .replace(',', '')
              .trim()
          )
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
    currency: '$',
    filename: `${utils.formatDate(bill.date)}_${VENDOR}_$${bill.amount.toFixed(
      2
    )}.pdf`,
    vendor: VENDOR,
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}
