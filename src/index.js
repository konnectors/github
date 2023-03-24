process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://33a142994ff042268d35af26f5238820@sentry.cozycloud.cc/121'

const { CookieKonnector, scrape, log, utils } = require('cozy-konnector-libs')
const moment = require('moment')

const VENDOR = 'Github'
const baseUrl = 'https://github.com'

class GithubConnector extends CookieKonnector {
  async testSession() {
    try {
      await this.request(`${baseUrl}/pulls`, {
        resolveWithFullResponse: true
      })
      return true
    } catch (err) {
      log('warn', `not logged: ${err.message.substring(0, 20)}`)
      return false
    }
  }

  async handle2FA(fields) {
    await this.deactivateAutoSuccessfulLogin()
    // to run this connector in standalone mode, just add "otp" field with your otp code
    let code = fields.otp
    if (!code) {
      code = await this.waitForTwoFaCode()
    }
    await this.signin({
      url: `${baseUrl}/sessions/two-factor`,
      formSelector: 'form',
      formData: {
        app_otp: code
      },
      validate: (statusCode, $, fullResponse) => {
        return fullResponse.request.uri.href === 'https://github.com/'
      }
    })
    await this.notifySuccessfulLogin()
  }

  async fetch(fields) {
    if (!(await this.testSession())) {
      log('info', 'Authenticating ...')
      try {
        await this.authenticate(fields.login, fields.password)
      } catch (err) {
        if (err.message === '2FA') {
          await this.handle2FA(fields)
        } else {
          throw err
        }
      }
      log('info', 'Successfully logged in')
      await this.saveSession()
    }

    log('info', 'Fetching the list of documents')
    const billingHistoryPath = (await this.checkOrga(fields))
      ? `/organizations/${fields.organization}/billing/history`
      : '/account/billing/history'
    const $ = await this.request(`${baseUrl}${billingHistoryPath}`)
    log('info', 'Parsing list of documents')
    const succeededBills = await this.parseBills(
      $,
      '.payment-history .succeeded'
    )
    const refundedBills = await this.parseBills($, '.payment-history .refunded')
    const bills = [].concat(succeededBills, refundedBills)

    log('info', 'Saving data to Cozy')
    await this.saveBills(bills, fields, {
      identifiers: ['github.com'],
      contentType: 'application/pdf',
      sourceAccount: this.accountId,
      sourceAccountIdentifier: fields.login,
      fileIdAttributes: ['id']
    })
  }

  async checkOrga({ login, organization }) {
    if (!organization) return false

    log(
      'info',
      'Checking if the specified organization is accessible with this account'
    )
    const $ = await this.request(`${baseUrl}/${login}`)
    const orgas = Array.from(
      $('a[data-hovercard-type=organization][itemprop=follows]')
    ).map(el => $(el).attr('href').slice(1))
    const result = orgas.includes(organization)

    if (!result)
      log(
        'warn',
        `Could not find the ${organization} organization, using the default billing address`
      )
    return result
  }

  async authenticate(username, password) {
    return await this.signin({
      url: `${baseUrl}/login`,
      formSelector: 'form',
      formData: {
        login: username,
        password: password
      },
      validate: (statusCode, $, fullResponse) => {
        log('info', `Login status code is: ${statusCode}`)
        log('info', fullResponse.request.uri.href)

        if (
          fullResponse.request.uri.href.includes(
            'https://github.com/sessions/two-factor'
          )
        ) {
          log('info', `2FA required`)
          throw new Error('2FA')
        }

        return fullResponse.request.uri.href === 'https://github.com/'
      }
    })
  }

  parseBills($, selector) {
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
            parseFloat(amount.replace('$', '').replace(',', '').trim())
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
      filename: `${utils.formatDate(
        bill.date
      )}_${VENDOR}_$${bill.amount.toFixed(2)}.pdf`,
      vendor: VENDOR
    }))
  }
}

const connector = new GithubConnector({
  // debug: 'simple',
  cheerio: true,
  json: false
})

connector.run()
