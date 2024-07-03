module.exports = {
  superlogin: {
    views: {
      expiration: {
        map: function (doc)
        {
          if (doc.user_id)
            emit(doc.expires, {user: doc.user_id, date: new Date(doc.expires).toUTCString()})
        }
      }
    }
  }
};
