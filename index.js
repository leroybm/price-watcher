const notifier = require('node-notifier');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const INTERVAL = 1000 * 60 * 5;

let tries = 0;

function parsePriceFromString(string) {
    return Number(string.replace(/[^0-9,]+/g, '').replace(',', '.'))
}

async function getOpenBoxPrice(url, browser) {
    const page = await browser.newPage();
    await page.goto('http://' + url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.openbox-button .preco', { timeout: 10000 });

    const priceHtml = await page.evaluate(() => {
        return window.document.querySelector('.openbox-button .preco').innerText;
    })

    return parsePriceFromString(priceHtml);
}

async function search(queries) {
    const start = +new Date();
    console.log(`\nStarting try number ${tries++}`);

    queries.forEach(async ({ name, url, alertOn, priceThreshold }) => {
        try {
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: "networkidle2" });
            await page.waitForSelector('#listagem-produtos', { timeout: 10000 });
        
            const { list, hostname } = await page.evaluate(() => {
                return {
                    list: window.document.getElementById('listagem-produtos').innerHTML,
                    hostname: window.location.hostname
                };
            });
        
            const $ = cheerio.load(list)
            const products = $('.sc-fzqARJ');
            
            const result = await Array.from(products).reduce(async (result, element) => {
                const $ = cheerio.load(element);

                result = await result;

                if (/icone_indisponivel/.test($.html())) {
                    result.availabeProductCount--;
                } else {
                    const price = parsePriceFromString($('.qatGF').html());
                    result.assignLowestPrice(price, 'lowestPrice');
                }
        
                if (/tag_openbox/.test($.html())) {
                    result.openBoxCount++;
                    const price = await getOpenBoxPrice(hostname + $('.item-nome').attr("href"), browser);
                    result.assignLowestPrice(price, 'openBoxPrice');
                }

                return result;
            }, {
                availabeProductCount: products.length,
                openBoxCount: 0,
                lowestPrice: null,
                openBoxPrice: null,
                assignLowestPrice: function assignLowestPrice(price, key) {
                    this[key] = (price < this[key] || this[key] === null) ? price : this[key]; 
                }
            });
        
            if (
                (alertOn.includes('AVAILABLE') && result.availabeProductCount && result.lowestPrice < priceThreshold) ||
                (alertOn.includes('OPEN_BOX') && result.openBoxCount && result.openBoxPrice < priceThreshold)
            ) {
                notifier.notify({
                    'title': `Kabum! Query: ${name}, lowestPrice: ${result.lowestPrice} (${result.openBoxPrice} openbox)`,
                    'message': `${result.availabeProductCount} products (${result.openBoxCount} openbox)`,
                });    
            }
        
            console.log(`Query: ${name}. Products found ${result.availabeProductCount} of ${products.length}, ${result.openBoxCount} open box. Took ${+Date.now() - start}ms. ${url}`)
            console.log(`Lowest price: ${result.lowestPrice} (${result.openBoxPrice} open box). `);
            await browser.close();
        } catch (error) {
            console.error(error);
        }
    });
}

const queries = [
    { name: '3060 Ti', url: 'https://www.kabum.com.br/cgi-local/site/listagem/listagem.cgi?string=rtx+3060+ti&btnG=', alertOn: ['AVAILABLE', 'OPEN_BOX'], priceThreshold: 3500 },
    { name: '3070', url: 'https://www.kabum.com.br/cgi-local/site/listagem/listagem.cgi?string=rtx+3070&btnG=', alertOn: ['OPEN_BOX', 'AVAILABLE'], priceThreshold: 4000 },
    // { name: 'Open Box Test', url: 'https://www.kabum.com.br/cgi-local/site/listagem/listagem.cgi?string=gt+730&btnG=', alertOn: ['OPEN_BOX'], priceThreshold: 300 }
];

search(queries)

setInterval(
    () => search(queries),
    INTERVAL
);
