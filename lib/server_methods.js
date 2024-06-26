/* global
  AccountsTemplates
*/
"use strict";

async function verifyRecaptcha(options, secretKey, connection) {
  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(options.profile.reCaptchaResponse)}&remoteip=${encodeURIComponent(connection.clientAddress)}`
    });

    const apiResponse = await response.json();

    if (!apiResponse.success) {
      throw new Meteor.Error(403, AccountsTemplates.texts.errors.captchaVerification,
          apiResponse['error-codes'] ? apiResponse['error-codes'].join(", ") : "Unknown Error.");
    }
  } catch (error) {
    throw new Meteor.Error("recaptcha-verification-failed", error.message);
  }
}

Meteor.methods({
  ATCreateUserServer: async function(options) {
    if (AccountsTemplates.options.forbidClientAccountCreation) {
      throw new Meteor.Error(403, AccountsTemplates.texts.errors.accountsCreationDisabled);
    }

    // createUser() does more checking.
    check(options, Object);
    const allFieldIds = AccountsTemplates.getFieldIds();

    // Picks-up whitelisted fields for profile
    const profile = options.profile;
    profile = _.pick(profile, allFieldIds);
    profile = _.omit(profile, "username", "email", "password");

    // Validates fields" value
    const signupInfo = _.clone(profile);
    if (options.username) {
      signupInfo.username = options.username;

      if (AccountsTemplates.options.lowercaseUsername) {
        signupInfo.username = signupInfo.username.trim().replace(/\s+/gm, ' ');
        options.profile.name = signupInfo.username;
        signupInfo.username = signupInfo.username.toLowerCase().replace(/\s+/gm, '');
        options.username = signupInfo.username;
      }
    }

    if (options.email) {
      signupInfo.email = options.email;

      if (AccountsTemplates.options.lowercaseUsername) {
        signupInfo.email = signupInfo.email.toLowerCase().replace(/\s+/gm, '');
        options.email = signupInfo.email;
      }
    }

    if (options.password) {
      signupInfo.password = options.password;
    }

    const validationErrors = {};
    let someError = false;

    // Validates fields values
    _.each(AccountsTemplates.getFields(), function(field) {
      const fieldId = field._id;
      const value = signupInfo[fieldId];

      if (fieldId === "password") {
        // Can"t Pick-up password here
        // NOTE: at this stage the password is already encripted,
        //       so there is no way to validate it!!!
        check(value, Object);
        return;
      }

      const validationErr = field.validate(value, "strict");
      if (validationErr) {
        validationErrors[fieldId] = validationErr;
        someError = true;
      }
    });

    if (AccountsTemplates.options.showReCaptcha) {
      let secretKey = null;

      if (AccountsTemplates.options.reCaptcha && AccountsTemplates.options.reCaptcha.secretKey) {
        secretKey = AccountsTemplates.options.reCaptcha.secretKey;
      } else {
        secretKey = Meteor.settings.reCaptcha.secretKey;
      }

      await verifyRecaptcha(options, secretKey, this.connection);
    }

    if (someError) {
      throw new Meteor.Error(403, AccountsTemplates.texts.errors.validationErrors, validationErrors);
    }

    // Possibly removes the profile field
    if (_.isEmpty(options.profile)) {
      delete options.profile;
    }

    // Create user. result contains id and token.
    const userId = await Accounts.createUser(options);
    // safety belt. createUser is supposed to throw on error. send 500 error
    // instead of sending a verification email with empty userid.
    if (! userId) {
      throw new Error("createUser failed to insert new user");
    }

    // Call postSignUpHook, if any...
    const postSignUpHook = AccountsTemplates.options.postSignUpHook;
    if (postSignUpHook) {
      postSignUpHook(userId, options);
    }

    // Send a email address verification email in case the context permits it
    // and the specific configuration flag was set to true
    if (options.email && AccountsTemplates.options.sendVerificationEmail) {
      await Accounts.sendVerificationEmail(userId, options.email);
    }
  },

  // Resend a user's verification e-mail
  ATResendVerificationEmail: async function (email) {
    check(email, String);

    const user = await Meteor.users.findOneAsync({ "emails.address": email });

    // Send the standard error back to the client if no user exist with this e-mail
    if (!user) {
      throw new Meteor.Error(403, "User not found");
    }

    try {
      await Accounts.sendVerificationEmail(user._id);
    } catch (error) {
      // Handle error when email already verified
      // https://github.com/dwinston/send-verification-email-bug
      throw new Meteor.Error(403, "Already verified");
    }
  },
});
