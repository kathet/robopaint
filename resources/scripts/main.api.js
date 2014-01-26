/*
 * @file Holds all RoboPaint CNC Server API extensions and related functions.
 *  For right now, this is just the high level API autopaint functionality.
 */

robopaint.api = {}; // All RoboPaint API state vars should be stored here

// Global remote print state and storage variables
robopaint.api.print = {
  enabled: false,
  queue: [], // Array of Objects for actual queue
  requestOptions: {} // Requested print settings for a new print queue item
}

// Establish high-level print endpoint ========================================

var printDisabledMessage = 'The SVG import API is currently disabled. Enable it in settings and then click the button in the RoboPaint GUI.';

/**
 * `robopaint/v1/print` endpoint
 * GET - List print queue and current status
 * POST - Create new queue items to print
 */
cncserver.createServerEndpoint('/robopaint/v1/print', function(req, res) {

  // Forbid any commands until printMode is enabled
  if (!robopaint.api.print.enabled) {
    return [403, printDisabledMessage];
  }

  if (req.route.method == 'get') { // GET list of print queue items and status
    return {code: 200, body: {
      status: 'ready',
      items: robopaint.api.print.queue.length,
      queue: robopaint.api.print.queue
    }};
  } else if (req.route.method == 'post') { // POST new print item
    var options = req.body.options;
    var msg = '';

    // Basic sanity check incoming content
    if (!req.body.svg) msg = "body content node required: svg";
    if (!req.body.options) {
      msg = 'body content node required: options';
    } else {
      if (!req.body.options.name) msg = 'name option required: options.name';
    }

    if (msg) return [406, msg];

    // Setup the load Callback that will be checked for on the subWindow pages
    // in edit and print modes to verify and trigger actions. Only those pages
    // decide the fate of this request.
    robopaint.api.print.requestOptions = options;
    robopaint.api.print.loadCallback = function(e) {
      if (e.status == 'success') { // Image loaded and everything is great!

        // Actually add item to queue
        var d = new Date();
        robopaint.api.print.queue.push({
          status: 'waiting',
          options: options,
          pathCount: e.pathCount,
          percentComplete: 0,
          startTime: d.toISOString(),
          svg: localStorage['svgedit-default'],
        });

        // Return response to client application finally
        res.status(201).send(JSON.stringify({
          status: 'verified and added to queue',
          uri: '/robopaint/v1/print/' + (robopaint.api.print.queue.length - 1),
          item: robopaint.api.print.queue[robopaint.api.print.queue.length - 1]
        }));
      } else {
        res.status(406).send(JSON.stringify({
          status: 'content verification failed',
          reason: e.error
        }));
        // Return to home mode after error
        robopaint.switchMode('home');
      }

      // Now that we're done, destroy the callback...
      delete robopaint.api.print.loadCallback;
    }

    // Store the SVG content
    window.localStorage.setItem('svgedit-default', req.body.svg);
    // Switch modes (this eventually triggers the above callback)
    robopaint.switchMode('edit');

    // TODO: Manage queue, send to print page with options

    return true; // Tell the server endpoint we'll handle the response from here...

  } else {
    return false; // 405 - Method Not Supported
  }

});

/**
 * `robopaint/v1/print/[QID]` endpoint
 * GET - Return print queue item
 * DELETE - Cancel print queue item
 */
cncserver.createServerEndpoint('/robopaint/v1/print/:qid', function(req, res) {
  var qid = req.params.qid;

  // Forbid any commands until printMode is enabled
  if (!robopaint.api.print.enabled) {
    return [403, printDisabledMessage];
  }

  if (!robopaint.printQueue[qid]){
    return [404, 'Queue ID ' + qid + ' not found'];
  }

  if (req.route.method == 'get') { // Is this a GET request?
    return {code: 200, body: robopaint.printQueue[qid]};
  } else if (req.route.method == 'delete'){
    // TODO: Actually stop printing if it was?
    robopaint.printQueue[qid].status = cancelled;
    return {code: 200, body: robopaint.printQueue[qid]};
  } else {
    return false; // 405 - Method Not Supported
  }

});

/**
 * Bind buttons specific for remote print
 */
function bindRemoteControls() {
  $('#remoteprint-window button').click(function(e) {
    if ($(this).is('.cancel')) {
      setRemotePrintWindow(false);
    }

    // TODO: Enable pause
    if ($(this).is('.pause')) {

    }

  });
}


/**
 * Attempt/Intend to open or close print window
 *
/**
 * Attempt/Intend to open or close print window
 *
 * @param {Boolean} toggle
 *   True to show window, false to hide.
 */
function setRemotePrintWindow(tryOpen, force) {
  // Sanity check: Do nothing if we're already open (or closed)
  if (robopaint.api.print.enabled == tryOpen) {
    return;
  }

  var toggle = false;
  var msg = "Hey there, welcome to Remote Paint mode! This mode will turn RoboPaint into a graphics 'print server', ready to take an image from another application and print it immediately!";
  msg+= "\n\n* Images sent will only be received while this mode is on";
  msg+= "\n\n* Once an image is finished, this mode will exit";
  msg+= "\n\n* Before clicking OK, make sure your bot is completely setup and ready to go!";
  msg+= "\n\n* Click cancel if you're not quite ready to go. You can also exit anytime while in Remote Paint mode";

  if (!tryOpen) {
    if (!force) {
      msg = "Are you sure you want to leave Remote Paint mode?";
      msg+= "\n\n Any print processes and client applications will be cancelled/disconnected.";
      toggle = !confirm(msg);
    }
  } else {
    toggle = confirm(msg);
  }

  // Sanity check now that we have confirmation
  if (robopaint.api.print.enabled == toggle) {
    return;
  }

  if (toggle) {
    $('#remoteprint-window').fadeIn('slow');
  } else {
    $('#remoteprint-window').fadeOut('slow');
  }
  setModal(toggle);
  robopaint.api.print.enabled = !!toggle; // Set printmode to exact boolean of toggle
}
