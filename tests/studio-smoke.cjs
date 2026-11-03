'use strict';
const { chromium } = require('playwright');
const { createServer } = require('../server');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:940}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.AcceptanceApp&&!AcceptanceApp.state.loading);
  const initialRight=await page.locator('#inspector').isVisible();const bottom=await page.locator('.ide-status').isVisible();
  await page.locator('.view-tabs [data-acceptance-action="overview"]').click();
  await page.locator('[data-acceptance-action="run-all"]').click();
  await page.waitForFunction(()=>!AcceptanceApp.state.busy&&AcceptanceApp.state.checks.length>=3);
  await page.locator('.ac-case-select').first().click();
  const chosenRight=await page.locator('#inspector').isVisible();
  await page.locator('[data-acceptance-action="close-details"]').click();
  const closed=!(await page.locator('#inspector').isVisible());
  console.log(JSON.stringify({initialRight,bottom,chosenRight,detailsCanClose:closed,checks:await page.evaluate(()=>AcceptanceApp.state.checks.map(c=>c.state)),pageErrors:errors}));
  if(initialRight||bottom||!chosenRight||!closed||errors.length)throw Error('studio interaction failed');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
