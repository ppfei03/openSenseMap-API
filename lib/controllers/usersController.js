'use strict';

const models = require('../models'),
  restify = require('restify'),
  requestUtils = require('../requestUtils'),
  Honeybadger = require('../utils').Honeybadger,
  tokenBlacklist = require('../helpers').tokenBlacklist,
  moment = require('moment');

const { User } = models;

const handleUserError = function handleUserError (err, next) {
  if (err.message === 'Duplicate user detected') {
    return next(new restify.BadRequestError(err.message));
  }

  if (err.errors) {
    const msg = Object.keys(err.errors)
      .map(f => `Parameter ${f} ${err.errors[f].message}`)
      .join(', ');

    return next(new restify.UnprocessableEntityError(msg));
  }

  Honeybadger.notify(err);

  return next(new restify.InternalServerError(err.message));
};

/**
 * @api {post} /users/register Register new
 * @apiName register
 * @apiDescription Register a new openSenseMap user
 * @apiGroup Users
 * @apiUse UserBody
 * @apiSuccess (Created 201) {String} code `Created`
 * @apiSuccess (Created 201) {String} message `Successfully registered new user`
 * @apiSuccess (Created 201) {String} token valid json web token
 * @apiSuccess (Created 201) {Object} data `{ "user": {"name":"fullname","email":"test@test.de","role":"user","language":"en_US","boxes":[]} }`
 */
const registerUser = function registerUser (req, res, next) {
  const { email, password, language } = req._userParams,
    name = req.params.name; // do not use _userParams. We want no treatment (no trim)

  new User({ name, email, password, language })
    .save()
    .then(function (newUser) {
      return newUser.createToken()
        .then(function (token) {
          return res.send(201, { code: 'Created', message: 'Successfully registered new user', data: { user: newUser }, token });
        })
        .catch(function (err) {
          next(new restify.InternalServerError(`User successfully created but unable to create jwt token: ${err.message}`));
        });
    })
    .catch(function (err) {
      handleUserError(err, next);
    });
};

/**
 * @api {post} /users/sign-in Sign in
 * @apiName sign-in
 * @apiDescription Sign in using email or name and password. The response contains a valid JSON Web Token
 * @apiGroup Users
 * @apiParam {String} email the email or name of the user
 * @apiParam {String} password the password of the user
 * @apiSuccess {String} code `Authorized`
 * @apiSuccess {String} message `Successfully signed in`
 * @apiSuccess {String} token valid json web token
 * @apiSuccess {Object} data `{ "user": {"name":"fullname","email":"test@test.de","role":"user","language":"en_US","boxes":[]} }`
 * @apiError {String} 403 Unauthorized
 */
const signIn = function signIn (req, res, next) {
  req.user.createToken()
    .then(function (token) {
      return res.send(200, { code: 'Authorized', message: 'Successfully signed in', data: { user: req.user }, token });
    })
    .catch(function (err) {
      next(new restify.InternalServerError(`unable to create jwt token: ${err.message}`));
    });
};

/**
 * @api {post} /users/sign-out Sign out
 * @apiName sign-out
 * @apiDescription Sign out using a valid JSON Web Token. Invalidates the current JSON Web Token
 * @apiGroup Users
 * @apiUse JWTokenAuth
 * @apiSuccess {String} code `Ok`
 * @apiSuccess {String} message `Successfully signed out`
 */
const signOut = function signOut (req, res) {
  tokenBlacklist.addTokenToBlacklist(req._jwt);

  res.send(200, { code: 'Ok', message: 'Successfully signed out' });
};

/**
 * @api {post} /users/request-password-reset request password reset
 * @apiName request-password-reset
 * @apiDescription request a password reset in case of a forgotten password. Sends a link with instructions to reset the users password to the specified email address. The link is valid for 12 hours.
 * @apiGroup Users
 * @apiParam {String} email the email of the user to request the password reset for
 * @apiSuccess {String} code `Ok`
 * @apiSuccess {String} message `Password reset initiated`
 */
// generate new password reset token and send the token to the user
const requestResetPassword = function requestResetPassword (req, res, next) {
  // gather request parameters
  const email = req._userParams.email;

  User.findOne({ email })
    .exec()
    .then(function (user) {
      if (!user) {
        return next(new restify.ForbiddenError('Password reset for this user not possible'));
      }

      return user.initPasswordReset()
        .then(function () {
          res.send(200, { code: 'Ok', message: 'Password reset initiated' });
        });

    })
    .catch(function (err) {
      handleUserError(err, next);
    });
};

/**
 * @api {post} /users/password-reset reset password with passwordResetToken
 * @apiName password-reset
 * @apiDescription reset password with token sent through email
 * @apiGroup Users
 * @apiParam {String} email the email of the user to reset
 * @apiParam {String} password new password. needs to be at least 8 characters
 * @apiParam {String} token the password reset token which was sent via email to the user
 * @apiSuccess {String} code `Ok`
 * @apiSuccess {String} message `Password successfully changed. You can now login with your new password`
 */
// set new password with reset token as auth
const resetPassword = function resetPassword (req, res, next) {
  const { password, token, email } = req._userParams;

  User.findOne({ email, resetPasswordToken: token })
    .exec()
    .then(function (user) {
      if (!user) {
        return next(new restify.ForbiddenError('Password reset for this user not possible'));
      }

      if (moment.utc().isAfter(moment.utc(user.resetPasswordExpires))) {
        return next(new restify.ForbiddenError('Password reset token expired'));
      }

      // set user specified password..
      // also changes the passwordResetToken
      user.set('password', password);

      return user.save()
        .then(function () {
          res.send(200, { code: 'Ok', message: 'Password successfully changed. You can now login with your new password' });
        });
    })
    .catch(function (err) {
      handleUserError(err, next);
    });
};

/**
 * @api {post} /users/confirm-email confirm email address
 * @apiName confirm-email
 * @apiDescription confirm email address to the system
 * @apiGroup Users
 * @apiParam {String} email the email of the user to confirm
 * @apiParam {String} token the email confirmation token which was sent via email to the user
 * @apiSuccess {String} code `Ok`
 * @apiSuccess {String} message `E-Mail successfully confirmed. Thank you`
 */
const confirmEmailAddress = function confirmEmailAddress (req, res, next) {
  const { token, email } = req._userParams;

  User.findOne({ $and: [ { $or: [ { email: email }, { unconfirmedEmail: email } ] }, { emailConfirmationToken: token } ] })
    .exec()
    .then(function (user) {
      if (!user) {
        return next(new restify.ForbiddenError('invalid email confirmation token'));
      }

      // mark user as confirmed
      user.set('emailConfirmationToken', '');
      user.set('emailIsConfirmed', true);

      return user.save()
        .then(function () {
          res.send(200, { code: 'Ok', message: 'E-Mail successfully confirmed. Thank you' });
        });
    })
    .catch(function (err) {
      handleUserError(err, next);
    });
};

/**
 * @api {post} /users/me/boxes list all boxes of the signed in user
 * @apiName getUserBoxes
 * @apiDescription List all boxes of the signed in user with secret fields
 * @apiGroup Users
 * @apiSuccess {String} code `Ok`
 * @apiSuccess {String} data A json object with a single `boxes` array field
 */
const getUserBoxes = function getUserBoxes (req, res, next) {
  req.user
    .populate('boxes')
    .execPopulate()
    .then(function (user) {
      res.send(200, { code: 'Ok', data: { boxes: user.boxes.map(b => b.toJSON({ includeSecrets: true })) } });
    })
    .catch(function (err) {
      handleUserError(err, next);
    });
};

/**
 * @api {get} /users/me Get details
 * @apiName getUser
 * @apiDescription Returns information about the currently signed in user
 * @apiGroup Users
 * @apiUse JWTokenAuth
 */
const getUser = function getUser (req, res) {
  res.send(200, { code: 'Ok', data: { me: req.user } });
};

/**
 * @api {put} /users/me Update user details
 * @apiName updateUser
 * @apiDescription Allows to change name, email, language and password of the currently signed in user. Changing the password triggers a sign out. The user has to log in again with the new password. Changing the mail triggers a Email confirmation process.
 * @apiGroup Users
 * @apiUse JWTokenAuth
 * @apiParam {String} [email] the new email address for this user.
 * @apiParam {String} [language] the new language for this user.
 * @apiParam {String} [name] the new name for this user. The name must consist of at least 4 and up to 40 characters and only allows to use alphanumerics (a-zA-Z0-9), dots (.), dashes (-), underscores (_) and spaces. The first character must be a letter or number.
 * @apiParam {String} [newPassword] the new password for this user. Should be at least 8 characters long.
 * @apiParam {String} currentPassword the current password for this user.
 */
const updateUser = function updateUser (req, res, next) {
  const { email, language, currentPassword, newPassword } = req._userParams,
    name = req.params.name; // do not use _userParams. We want no treatment (no trim)

  // don't allow email and password change in one request
  if (email && newPassword) {
    return next(new restify.BadRequestError('You cannot change your email address and password in the same request.'));
  }

  // create a promise which resolves with true. needed if there is no password change
  let p = Promise.resolve(true);

  // for password and email changes, require parameter currentPassword to be valid.
  if ((newPassword && newPassword !== '') || (email && email !== '')) {
    // check if the request includes the old password
    if (!currentPassword || currentPassword === '') {
      return next(new restify.BadRequestError('To change your password or email address, please supply your current password.'));
    }
    p = req.user.checkPassword(currentPassword);

    // check new password against password rules
    if (newPassword && User.validatePassword(newPassword) === false) {
      return next(new restify.BadRequestError('New password should have at least 8 characters'));
    }
  }

  const msgs = [];
  let signOut = false,
    somethingsChanged = false;
  p
    .then(function (oldPasswordIsCorrect) {
      if (oldPasswordIsCorrect === false) {
        return next(new restify.BadRequestError('Current password not correct.'));
      }

      // at this point its clear the user is allowed to change the details of their profile

      // we only set changed properties
      if (name && name !== '' && req.user.name !== name) {
        req.user.name = name;
        somethingsChanged = true;
      }

      if (language && language !== '' && req.user.language !== language) {
        req.user.language = language;
        somethingsChanged = true;
      }

      if (email && email !== '' && req.user.email !== email) {
        req.user.unconfirmedEmail = email;
        msgs.push(' E-Mail changed. Please confirm your new address. Until confirmation, sign in using your old address');
        somethingsChanged = true;
      }

      // at this point its also clear the new password conforms to the password rules
      if (newPassword && newPassword !== '') {
        req.user.password = newPassword;
        msgs.push(' Password changed. Please log in with your new password');
        signOut = true;
        somethingsChanged = true;
      }

      if (somethingsChanged === false) {
        res.send(200, { code: 'Ok', message: 'No changed properties supplied. User remains unchanged.' });
      }

      // save user
      return req.user.save();
    })
    .then(function (updatedUser) {
      if (signOut === true) {
        tokenBlacklist.addTokenToBlacklist(req._jwt);
      }
      res.send(200, { code: 'Ok', message: `User successfully saved.${msgs.join('.')}`, data: { me: updatedUser } });
    })
    .catch(function (err) {
      if (err && err.errors && err.errors.unconfirmedEmail) {
        return next(new restify.UnprocessableEntityError(`New email address invalid or an user with the email address ${email} already existsh.`));
      }

      handleUserError(err, next);
    });

};

module.exports = {
  registerUser: [
    requestUtils.checkContentType,
    requestUtils.retrieveParameter('email', 'String', true),
    requestUtils.retrieveParameter('password', 'String', true),
    requestUtils.retrieveParameter('name', 'String', true),
    requestUtils.retrieveParameter('language', 'String', 'en_US'),
    registerUser
  ],
  signIn: [
    requestUtils.checkContentType,
    signIn
  ],
  signOut,
  resetPassword: [
    requestUtils.retrieveParameter('token', 'String', true),
    requestUtils.retrieveParameter('password', 'String', true),
    requestUtils.retrieveParameter('email', 'String', true),
    resetPassword
  ],
  requestResetPassword: [
    requestUtils.checkContentType,
    requestUtils.retrieveParameter('email', 'String', true),
    requestResetPassword
  ],
  confirmEmailAddress: [
    requestUtils.checkContentType,
    requestUtils.retrieveParameter('token', 'String', true),
    requestUtils.retrieveParameter('email', 'String', true),
    confirmEmailAddress
  ],
  getUserBoxes,
  updateUser: [
    requestUtils.retrieveParameter('email', 'String'),
    requestUtils.retrieveParameter('currentPassword', 'String'),
    requestUtils.retrieveParameter('newPassword', 'String'),
    requestUtils.retrieveParameter('name', 'String'),
    requestUtils.retrieveParameter('language', 'String'),
    updateUser
  ],
  getUser
};