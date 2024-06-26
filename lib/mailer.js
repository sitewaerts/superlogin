'use strict';
const fs = require('fs');
const BPromise = require('bluebird');
const nodemailer = require('nodemailer');
const nodemailerStubTransport = require('nodemailer-stub-transport');
const ejs = require('ejs');

module.exports = function(config) {

  // Initialize the transport mechanism with nodemailer
  let transporter;
  const customTransport = config.getItem('mailer.transport');
  if(config.getItem('testMode.noEmail')) {
    transporter = nodemailer.createTransport(nodemailerStubTransport());
  } else if(customTransport) {
    transporter = nodemailer.createTransport(customTransport(config.getItem('mailer.options')));
  } else {
    transporter = nodemailer.createTransport(config.getItem('mailer.options'));
  }

  this.sendEmail = function(templateName, email, locals) {
    try
    {
      // load the template and parse it
      const templateFile = config.getItem('emails.' + templateName + '.template');
      if (!templateFile)
      {
        return Promise.reject('No template found for "' + templateName + '".');
      }
      const template = fs.readFileSync(templateFile, 'utf8');
      if (!template)
      {
        return Promise.reject('Failed to locate template file: ' + templateFile);
      }

      const inlineSubject = !!config.getItem('emails.' + templateName + '.inlineSubject');

      const raw = ejs.render(template, locals).trim();
      let body, subject;
      if(inlineSubject)
      {
        const re = new RegExp('Subject:(.+)');
        subject = re.exec(raw)[1];
        body = raw.replace(re, "").trim();
      }
      else{
        body = raw;
        subject = config.getItem('emails.' + templateName + '.subject');
      }
      const format = config.getItem('emails.' + templateName + '.format');
      // see https://nodemailer.com/message/
      const mailOptions = {
        from: config.getItem('mailer.fromEmail'),
        replyTo: config.getItem('mailer.replyEmail'),
        to: email,
        subject: subject
      };
      if (format === 'html')
        mailOptions.html = body;
      else
        mailOptions.text = body;

      if (config.getItem('testMode.debugEmail'))
        console.log(mailOptions);

      // send the message
      const sendEmail = BPromise.promisify(transporter.sendMail, {context: transporter});
      return sendEmail(mailOptions).catch(function (e)
      {
        console.error('Failed to send email', mailOptions, e);
        return Promise.reject('Failed to send email: ' + (e.message || e));
      });
    }
    catch(err){
      console.error('Failed to send email', err);
      return Promise.reject('Failed to send email: ' + (err.message || err));
    }
  };

  return this;

};
