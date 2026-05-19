-- Harvest sessionStorage + cookies from an open fantasy402.com/manager.html tab and POST to local proxy.
on run
  set harvestJs to "
    (function() {
      function cookiePair(name) {
        var prefix = name + '=';
        var parts = document.cookie.split(';');
        for (var i = 0; i < parts.length; i++) {
          var t = parts[i].trim();
          if (t.indexOf(prefix) === 0) return t.split('=').slice(1).join('=');
        }
        return '';
      }
      var jwt = '';
      try {
        var raw = sessionStorage.getItem('credentials');
        if (raw) {
          var cred = JSON.parse(raw);
          if (cred && cred.code) jwt = String(cred.code).trim();
        }
      } catch (e) {}
      if (!jwt) return JSON.stringify({ error: 'no JWT in sessionStorage' });
      var payload = {
        authorization: jwt.startsWith('Bearer ') ? jwt : 'Bearer ' + jwt,
        cfClearance: cookiePair('cf_clearance'),
        cfBm: cookiePair('__cf_bm'),
        customerId: sessionStorage.getItem('customerID') || '',
        userAgent: navigator.userAgent,
        referer: location.href
      };
      return fetch('http://127.0.0.1:8791/refresh-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function(r) { return r.text(); }).then(function(t) { return t; });
    })();
  "
  tell application "Google Chrome"
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains "fantasy402.com/manager" then
          set result to execute t javascript harvestJs
          return result
        end if
      end repeat
    end repeat
  end tell
  return "no manager tab found"
end run
