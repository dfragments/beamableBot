// 在文件顶部添加puppeteer依赖
import fs from "fs/promises";
import chalk from "chalk";
import puppeteer from 'puppeteer';
import { log } from "console";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// Helper Function: Logger
function logger(message, level = "info") {
    const now = new Date().toISOString();
    const colors = {
        info: chalk.blue,
        warn: chalk.yellow,
        error: chalk.red,
        success: chalk.green,
        debug: chalk.magenta,
    };
    const color = colors[level] || chalk.white;
    console.log(color(`[${now}] [${level.toUpperCase()}]: ${message}`));
}


async function readFiles() {
    const proxyStr = await fs.readFile("proxies.txt", "utf-8");
    const proxies = proxyStr.trim().split("\n").map(proxy => proxy.trim());
    const cookieData = await fs.readFile("cookies.txt", "utf-8");
    const cookies = cookieData.trim().split("\n").map(cookie => cookie.trim());
    return { proxies, cookies };
}

async function initBrowserSession(cookie, proxyUrl) {
    const parsedProxy = proxyUrl ? new URL(proxyUrl) : null;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            !parsedProxy ? '' : `--proxy-server=${parsedProxy.hostname}:${parsedProxy.port}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1200,800'  // 新增窗口尺寸参数
        ],
        defaultViewport: {
            width: 1500,  // 设置视口宽度
            height: 1000, // 可选高度设置
            deviceScaleFactor: 1
        }
    });

    // Cookie 处理逻辑
    const cookies = cookie.split(';').map(c => {
        const [name, value] = c.trim().split('=');
        return {
            name: name.trim(),
            value: decodeURIComponent(value.trim()),
            domain: name?.includes('_ga') ? '.beamable.network' : 'hub.beamable.network',
            path: '/',
            secure: true,
            httpOnly: name.includes('harbor-session'),
            sameSite: 'Lax'
        };
    });

    await browser.setCookie(...cookies);

    const page = await browser.newPage();

    // 代理认证

    if (parsedProxy) {
        await page.authenticate({
            username: parsedProxy.username,
            password: parsedProxy.password
        });
    }

    return { browser, page };
}

async function getCheckInPage(page) {
    try {
        await page.goto('https://hub.beamable.network/modules/dailycheckin', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // 等待任务列表加载
        await page.waitForSelector('#moduleGriddedContainer', {
            timeout: 15000
        });

        await sleep(5000); // 等待3秒以确保页面完全加载

        // 提取button数据
        const checkInButtons = await page.$$('#moduleGriddedContainer button');

        return checkInButtons
    } catch (error) {
        logger(`获取Sold任务列表失败: ${error.message}`, 'error');
        return [];
    }
}

async function getQuestsSold(page) {
    try {
        await page.goto('https://hub.beamable.network/modules/questsold', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // 等待任务列表加载
        await page.waitForSelector('#moduleGriddedContainer', {
            timeout: 15000
        });

        await sleep(5000); // 等待3秒以确保页面完全加载

        // 提取任务数据
        const quests = await page.$$eval('#moduleGriddedContainer > div > div.quests div.bg-content', divs => {
            return divs.map(div => {
                const name = div.querySelector('div.mb-4.flex.justify-between > div > div > .h3')?.innerText.trim();
                const link = div.querySelector('a')?.href;
                // 修正选择器逻辑
                const isClaimed = Array.from(div.querySelectorAll('button, span, div')).some(el =>
                    el.textContent.trim() === 'Claimed'
                );
                return {
                    name,
                    link,
                    keepGoingLink: link,
                    isClaimed,
                };
            });
        });

        return quests
    } catch (error) {
        logger(`获取Sold任务列表失败: ${error.message}`, 'error');
        return [];
    }
}

// 新增函数（添加在现有函数附近）
async function getLaunchQuests(page) {
    try {
        await page.goto('https://icanhazip.com', { waitUntil: 'networkidle2' });
        const publicIP = await page.$eval('pre', el => el.textContent.trim());
        console.log('当前代理IP:', publicIP); // 应该显示156.250.104.70

        await page.goto('https://hub.beamable.network/modules/launchquests', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // 等待任务列表加载
        await page.waitForSelector('#moduleGriddedContainer', {
            timeout: 15000
        });

        await sleep(5000); // 等待3秒以确保页面完全加载

        // 提取任务数据
        const quests = await page.$$eval('#moduleGriddedContainer > div > div.quests div.bg-content', divs => {
            return divs.map(div => {
                const name = div.querySelector('div.mb-4.flex.justify-between > div > div > div')?.innerText.trim();
                const link = div.querySelector('a')?.href;
                // 修正选择器逻辑
                const keepGoingButton = Array.from(div.querySelectorAll('button')).find(btn =>
                    btn.textContent.trim() === 'Keep Going' ||
                    btn.textContent.trim() === 'Claim Reward'
                );
                const isCompleted = keepGoingButton && !keepGoingButton;
                const keepGoingLink = keepGoingButton?.closest('a')?.href;
                return {
                    name,
                    link,
                    isCompleted,
                    keepGoingLink,
                };
            });
        });

        return quests
    } catch (error) {
        logger(`获取任务列表失败: ${error.message}`, 'error');
        return [];
    }
}

async function completeQuest(page, questLink) {
    try {
        await page.goto(questLink, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await sleep(5000); // 等待3秒以确保页面完全加载

        // 新增完成状态检查逻辑
        try {
            // 使用更可靠的等待和定位方式
            const completedLinks = await page.$$eval('a', links => {
                return links
                    .filter(link => {
                        const text = link.textContent.trim();
                        return text.toUpperCase() === 'COMPLETED';
                    })
                    .map(link => ({
                        href: link.href,
                        text: link.textContent.trim()
                    }));
            });

            if (completedLinks.length > 0) {
                logger(`找到 ${completedLinks.length} 个 COMPLETED 链接`, 'debug');
                const claimButtons = await page.$$('button');

                logger(`找到 ${claimButtons.length} 个 按钮`, 'debug');

                // 过滤出符合条件的按钮
                const filteredButtons = [];
                for (const button of claimButtons) {
                    const text = await button.evaluate(el => el.textContent.trim());
                    if (text.toLowerCase() === 'claim reward') {
                        filteredButtons.push(button);
                    }
                }

                if (filteredButtons?.length > 0) {
                    await filteredButtons[0].evaluate(el => el.scrollIntoView({
                        block: 'center',
                        inline: 'center'
                    }));

                    // 添加点击前延迟
                    await sleep(1000);

                    // 执行点击操作
                    await filteredButtons[0].click({
                        delay: 100,        // 模拟人类点击延迟
                        force: true,       // 强制点击，即使元素被遮挡
                        waitForNetworkIdle: true  // 等待网络请求完成
                    });

                    logger('已点击按钮，奖励领取成功', 'success');

                    // 等待点击后的页面变化
                    await page.waitForNetworkIdle({ idleTime: 1000 });
                    await sleep(5000);
                    // 返回上一页
                    await page.goBack({
                        waitUntil: 'networkidle2',  // 等待网络空闲
                        timeout: 30000              // 超时时间30秒
                    });
                    return;
                }
            }
        } catch (error) {
            logger(`奖励领取失败: ${error.message}`, 'error');  // 使用统一 logger
        }

        // 新增点击逻辑
        await Promise.race([
            page.waitForSelector('#moduleGriddedContainer', { timeout: 15000 }),
            page.waitForSelector('//*[contains(text(), "Click the Link")]', {
                visible: true,
                timeout: 5000,
                xpath: true // 明确指定使用 XPath
            })
        ]);

        // 如果找到需要点击的链接
        const elements = await page.$$('div, a, button'); // 根据实际情况调整元素类型
        const clickLinks = [];

        for (const el of elements) {
            const text = await el.evaluate(node => node.textContent?.trim());
            if (text === 'Click the Link') {
                clickLinks.push(el);
            }
        }
        if (clickLinks?.length > 0) {
            const clickLink = clickLinks[0];

            // 获取当前浏览器实例
            const browser = page.browser();

            // 点击前记录当前标签页
            const originalPage = page;

            // 设置新标签页监听
            const newPagePromise = new Promise(resolve => {
                browser.once('targetcreated', async target => {
                    const newPage = await target.page();
                    resolve(newPage);
                });
            });

            await clickLink.click();
            logger('检测到需要点击的链接，已执行点击操作', 'success');

            // 等待新标签页打开（最多5秒）
            const newPage = await Promise.race([
                newPagePromise,
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);

            if (newPage) {
                logger(`新标签页已打开，5秒后关闭 [${newPage.url()}]`, 'debug');
                await sleep(5000);
                await newPage.close();
            }

            // 切换回原始标签页并刷新
            await originalPage.bringToFront();
            await originalPage.reload({ waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(3000); // 等待5秒以确保页面完全加载
            await completeQuest(page, questLink);
        }

    } catch (error) {
        logger(`访问任务链接失败: ${error.message}`, 'error');
        return;
    }
}

// 在现有代码中找到合适的位置调用（例如在main函数中）
async function main() {
    while (true) {
        const { proxies, cookies } = await readFiles();
        for (let i = 0; i < cookies.length; i++) {
            logger(`正在处理第 ${i + 1} 个账户`)
            const cookie = cookies[i]
            const { page, browser } = await initBrowserSession(cookie, proxies[i]);
            const questList = await getLaunchQuests(page);
            logger(`launchquests获取成功: ${questList.length}，已完成: ${questList.filter(q => q.isCompleted).length}个，未完成: ${questList.filter(q => !q.isCompleted).length}个，开始执行未完成任务`)
            for (let j = 0; j < questList.length; j++) {
                const quest = questList[j];
                if (!quest.isCompleted) {
                    if(quest.link) {
                        logger(`任务 ${j + 1} 未完成, 前往完成: ${quest.link}`)
                        await completeQuest(page, quest.link);
                        logger(`任务 ${j + 1} 已完成，等待 10 秒进入下一个任务`)
                        logger("等待 10 秒进入下一个任务", 'debug');
                        await sleep(10000);
                    }
                }
            }
            logger('所有launch任务已完成，开始查询questsold任务列表', 'debug')

            const questsoldList = await getQuestsSold(page);
            logger(`soldquests获取成功: ${questsoldList.length}，已完成: ${questsoldList.filter(q => q.isClaimed).length}个，未完成: ${questList.filter(q => !q.isClaimed).length}个，开始执行未完成任务`)
            for (let j = 0; j < questsoldList.length; j++) {
                const quest = questsoldList[j];
                if (!quest.isClaimed) {
                    if(quest.link) {
                        logger(`任务 ${j + 1} 未完成, 前往完成: ${quest.link}`)
                        await completeQuest(page, quest.link);
                        logger(`任务 ${j + 1} 已完成，等待 10 秒进入下一个任务`)
                        logger("等待 10 秒进入下一个任务", 'debug');
                        await sleep(10000);
                    }
                }
            }
            logger('所有questsold任务已完成，开始查询签到状态', 'debug')
            const checkInButtons = await getCheckInPage(page);
            console.log(checkInButtons, 'checkInButtons')
            if (checkInButtons?.length > 0) {
                const lastButton = checkInButtons[checkInButtons.length - 1];
                try {
                    // 点击最后一个按钮
                    await lastButton.click();
                    logger('已点击最后一个按钮，展开所有日期', 'success');

                    await sleep(5000); // 等待页面加载

                    const claimButtons = await page.$$('#moduleGriddedContainer button');

                    if (claimButtons?.length > 0) {
                        for (const btn of claimButtons) {
                            const isDisabled = await btn.evaluate(el => el.hasAttribute('disabled'));
                            if (isDisabled) {
                                logger('发现不可用按钮，停止领取操作', 'warn');
                                break; // 直接跳出循环
                            }
                            try {
                                await btn.click({
                                    delay: 100,
                                    force: true
                                });
                                logger('成功领取每日签到奖励', 'success');
                                await sleep(3000); // 等待领取动画完成
                            } catch (error) {
                                logger(`领取失败: ${error.message}`, 'error');
                            }
                        }
                    } else {
                        logger('没有可领取的签到奖励', 'warn');
                    }
                } catch (error) {
                    logger(`点击最后一个按钮失败: ${error.message}`, 'error');
                }
            }
        }
        logger("等待1天后继续每日任务", 'warn')
        await new Promise(resolve => setTimeout(resolve, 24 * 60 * 1000))
    }
}

main();
