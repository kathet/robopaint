/**
 * @file Holds all initially loaded and Node.js specific initialization code,
 * central cncserver object to control low-level non-restful APIs, and general
 * "top-level" UI initialization for settings.
 *
 */

global.$ = $;

var fs = require('fs');
var cncserver = require('cncserver');
var gui = require('nw.gui');

var barHeight = 40;
var isModal = false;
var initializing = false;
var appMode = 'home';
var $subwindow = {}; // Placeholder for subwindow iframe
var subWin = {}; // Placeholder for subwindow "window" object

// Set the global scope object for any robopaint level details needed by other modes
var robopaint = {
  settings: {}, // Holds the "permanent" app settings data
  statedata: {}, // Holds per app session volitile settings
  // currentBot lies outside of settings as it actually controls what settings will be loaded
  currentBot: getCurrentBot()
};

// Option buttons for connections
// TODO: Redo this is a message management window system!!!
var $options;
var $stat;

/**
 * Central home screen initialization (jQuery document ready callback)
 */
$(function() {
 initializing = true;

  // Bind and run inital resize first thing
  $(window).resize(responsiveResize);
  responsiveResize();

  // Set visible version from manifest (with appended bot type if not WCB)
  var bt = robopaint.currentBot.type != "watercolorbot" ? ' - ' + robopaint.currentBot.name : '';
  $('span.version').text('(v' + gui.App.manifest.version + ')' + bt);

  // Bind settings controls & Load up initial settings!
  // @see scripts/main.settings.js
  bindSettingsControls();
  loadSettings();

  // Bind all the functionality required for Remote Print mode
  // @see scripts/main.api.js
  bindRemoteControls();

  // Load the quickload list
  initQuickload();

  // Bind the tooltips
  initToolTips();

  // Add the secondary page iFrame to the page
  $subwindow = $('<iframe>').attr({
    height: $(window).height() - barHeight,
    border: 0,
    id: 'subwindow'
  })
    .css('top', $(window).height())
    .hide()
    .appendTo('body');

  // Prep the connection status overlay
  $stat = $('body.home h1');
  $options = $('.options', $stat);

  // Actually try to init the connection and handle the various callbacks
  startSerial();

  getColorsets(); // Load the colorset configuration data

  bindMainControls(); // Bind all the controls for the main interface
})

/**
 * Bind all DOM main window elements to their respective functionality
 */
function bindMainControls() {
  // Bind the continue/simulation mode button functionality
  $('button.continue', $options).click(function(e){
    $stat.fadeOut('slow');
    cncserver.continueSimulation();
    cncserver.serialReadyInit();

    if (initializing) {
      // Initialize settings...
      loadSettings();
      saveSettings();
      $('body.home nav').fadeIn('slow');
      initializing = false;
    }

    setModal(false);
  });

  // Bind the reconnect button functionality
  $('button.reconnect').click(function(e){
    // Reconnect! Resets status and tries to start again
    $options.hide();
    startSerial();
  });


  gui.Window.get().on('close', onClose); // Catch close event

  // Bind links for home screen central bubble nav links
  $('nav a').click(function(e) {
     $('#bar-' + e.target.id).click();
    e.preventDefault();
  });

  // Bind links for toolbar ===========================
  $('#bar a.mode').click(function(e) {
    e.preventDefault();

    checkModeClose(function(){
      var $target = $(e.target);
      var mode = $target[0].id.split('-')[1];

      // Don't do anything if already selected
      if ($target.is('.selected')) {
        return false;
      }

      robopaint.switchMode(mode); // Actually switch to the mode
    }, false, e.target.id.split('-')[1]);

    e.preventDefault();
  });

  // Bind toolbar modal links =======================
  $('#bar a.modal').click(function(e){
    var modal = this.id.split('-')[1];
    switch(modal) {
      case 'settings':
        // @see scripts/main.settings.js
        setSettingsWindow(true);
        break;
      case 'remoteprint':
        // @see scripts/main.api.js
        checkModeClose(function(){
          robopaint.switchMode('home');
          setRemotePrintWindow(true);
        }, false, "home");

        break;
    }

    e.preventDefault();
  });

  // Bind help click (it's special)
  $('#bar-help').click(function(e){
    gui.Shell.openExternal(this.href);
    e.preventDefault();
  });
}

/**
 * Actually does the switching between modes (no checking/confirmation steps)
 *
 * @param {String} mode
 *   The mode's machine name. NOTE: Does no sanity checks!
 */
robopaint.switchMode = function(mode) {
  if (appMode == mode) { // Don't switch modes if already there
    return;
  }

  appMode = mode; // Set the new mode

  $target = $('a#bar-' + mode);

  // Select toolbar element (and deselect last)
  $('#bar a.selected').removeClass('selected');
  $target.addClass('selected');

  switch (mode) {
    case 'home':
      $('nav, #logo').fadeIn('slow');
      $('#loader').hide();
      $subwindow.fadeOut('slow', function(){$subwindow.attr('src', "");});
      break;
    default:
      $('nav, #logo').fadeOut('slow');
      $('#loader').fadeIn();
      $subwindow.fadeOut('slow', function(){
        $subwindow.attr('src', $target.attr('href'));
      });
  }
}

/**
 * Specialty JS window resize callback for responsive element adjustment
 */
function responsiveResize() {
  // Position settings window dead center
  var $s = $('#settings');
  var size = [$s.width(), $s.height()];
  var win = [$(window).width(), $(window).height()];
  $s.css({left: (win[0]/2) - (size[0]/2), top: (win[1]/2) - (size[1]/2)});
  // Set height for inner settings content window, just remove tab and H2 height
  $s.find('.settings-content').height($s.height() - 80);

  // Position window
  size = $('nav').width();
  $('nav').css({
    left: (win[0]/2) - (size/2),
    top: '70%'
  });

  // Set subwindow height
  if ($subwindow.height) {
    $subwindow.height($(window).height() - barHeight);
  }

  // Remote Print Window sizing
  if (robopaint.api.print.enabled) {
    var $rpWindow = $('#remoteprint-window');
    var scale = {};
    size = [$rpWindow.width(), $rpWindow.height()];
    var padding = {x: 20, y: 65};
    var fullSize = [$('#preview-scale-container').width(), $('#preview-scale-container').height()];

    scale.x = (size[0] - padding.x) / fullSize[0];
    scale.y = (size[1] - padding.y) / fullSize[1];

    scale = scale.x < scale.y ? scale.x : scale.y;

    $('#preview-scale-container').css({
      '-webkit-transform': 'scale(' + scale +')',
      left: size[0]/2 - ((fullSize[0]/2) * scale) + padding.x*2,
      top: size[1]/2 - ((fullSize[1]/2) * scale) + padding.y*2
    });
  }
};

/**
 * Binds all the callbacks functions for controlling CNC Server via its Node API
 */
function startSerial(){
  setMessage('Starting up...', 'loading');

  cncserver.start({
    botType: robopaint.currentBot.type,
    success: function() {
      setMessage('Port found, connecting...');
    },
    error: function(err) {
      setMessage('Couldn\'t connect! - ' + err, 'warning');
      $options.slideDown('slow');
    },
    connect: function() {
      setMessage('Connected!', 'success');

      $stat.fadeOut('slow');
      setModal(false);

      // If caught on startup...
      if (initializing) {
        $('body.home nav').fadeIn('slow');
        initializing = false;
      }

      // Initialize settings...
      loadSettings();
      saveSettings();

    },
    disconnect: function() {
      setModal(true);
      $stat.show();
      setMessage('Bot Disconnected!', 'error');
      $options.slideDown();
    }
  });
}

/**
 * Runs on application close request to catch exits and alert user with dialog
 * if applicable depending on mode status
 */
function onClose() {
  var w = this;

  checkModeClose(function(){
    w.close(true); // Until this is called
  }, true);
}


/**
 * Runs current subwindow/mode specific close delay functions (if they exist)
 *
 * @param {Function} callback
 *   Function is called when check is complete, or is passed to subwindow close
 * @param {Boolean} isGlobal
 *   Demarks an application level quit, function is also called for mode changes
 * @param {String} destination
 *   Name of mode change target. Used to denote special reactions.
 */
function checkModeClose(callback, isGlobal, destination) {
  // Settings mode not considered mode closer
  if (destination == 'settings') {
    callback(); return;
  }

  if (appMode == 'print' || appMode == 'edit') {
    subWin.onClose(callback, isGlobal);
  } else {
    callback();
  }
}

/**
 * Initialize the toolTip configuration and binding
 */
function initToolTips() {

  $('#bar a.tipped, nav a').qtip({
    style: {
      border: {
        width: 5,
        radius: 10
      },
      padding: 10,
      tip: true,
      textAlign: 'center',
      name: 'blue'
    },
    position: {
      corner: {
        target: 'bottomMiddle',
        tooltip: 'topMiddle'
      },
      adjust: {
        screen: true,
        y: 6,
        x: -5
      }
    },
    api: {
      beforeShow: beforeQtip
    }
  }).click(function(){
    $(this).qtip("hide");
  });

  function beforeQtip(){
    // Move position to be more centered for outer elements
    if (this.id <= 1) {
      this.elements.wrapper.parent().css('margin-left', -30);
    }

    if (this.getPosition().left + this.getDimensions().width + 250 > $(window).width()) {
      this.elements.wrapper.parent().css('margin-left', 30);
    }
  }
}

/**
 * Initialize and bind Quickload file list functionality
 */
function initQuickload() {
  var $load = $('#bar-load');
  var $loadList = $('#loadlist');
  var paths = ['resources/svgs'];

  // TODO: Support user directories off executable
  var svgs = fs.readdirSync(paths[0]);

  // Bind Quick Load Hover
  $load.click(function(e) {
    if ($loadList.is(':visible')) {
      $loadList.fadeOut('slow');
    } else {
      $loadList.css('left', $load.offset().left + $load.width());
      $loadList.fadeIn('fast');
    }
    return false;
  });

  // Load in SVG files for quick loading
  if (svgs.length > 0) {
    $loadList.html('');
    for(var i in svgs) {
      var s = svgs[i];
      var name = s.split('.')[0].replace(/_/g, ' ');
      $('<li>').append(
        $('<a>').text(name).data('file', paths[0] + '/' + s).attr('href', '#')
      ).appendTo($loadList);
    }
  }

  // Bind loadlist item click load
  $('a', $loadList).click(function(e) {
    $loadList.fadeOut('slow');
    var fileContents = fs.readFileSync($(this).data('file'));

    // Push the files contents into the localstorage object
    window.localStorage.setItem('svgedit-default', fileContents);

    if (appMode == 'print') {
      subWin.cncserver.canvas.loadSVG();
    } else if (appMode == 'edit') {
      subWin.methodDraw.openPrep(function(doLoad){
        if(doLoad) subWin.methodDraw.canvas.setSvgString(localStorage["svgedit-default"]);
      });

    } else {
      $('#bar-print').click();
    }

    return false;
  });
}


/**
 * "Public" helper function to fade in iframe when it's done loading
 */
function fadeInWindow() {
  if ($subwindow.offset().top != barHeight) {
    $subwindow.hide().css('top', barHeight).fadeIn('fast');
  }
  subWin = $subwindow[0].contentWindow;
}


/**
 * Fetches all watercolor sets available from the colorsets dir
 */
function getColorsets() {
  var colorsetDir = 'resources/colorsets/';
  var files = fs.readdirSync(colorsetDir);
  var sets = [];

  // List all files, only add directories
  for(var i in files) {
    if (fs.statSync(colorsetDir + files[i]).isDirectory()) {
      sets.push(files[i]);
    }
  }

  robopaint.statedata.colorsets = {'ALL': sets};

  $.each(sets, function(i, set){
    var setDir = colorsetDir + set + '/';
    var c = JSON.parse(fs.readFileSync(setDir + set + '.json'));

    $('#colorset').append(
      $('<option>')
        .attr('value', set)
        .text(c.name)
        .prop('selected', set == robopaint.settings.colorset)
    );

    // Add pure white to the end of the color set for auto-color
    c.colors.push({'White': '#FFFFFF'});

    // Process Colors to avoid re-processing later
    var colorsOut = [];
    for (var i in c.colors){
      var name = Object.keys(c.colors[i])[0];
      var h = c.colors[i][name];
      var r = robopaint.utils.colorStringToArray(h);
      colorsOut.push({
        name: name,
        color: {
          HEX: h,
          RGB: r,
          HSL: robopaint.utils.rgbToHSL(r),
          YUV: robopaint.utils.rgbToYUV(r)
        }
      });
    }

    robopaint.statedata.colorsets[set] = {
      name: c.name,
      baseClass: c.styles.baseClass,
      colors: colorsOut,
      stylesheet: $('<link>').attr({rel: 'stylesheet', href: setDir + c.styles.src})
    };
  });
}

/**
 * Set modal message
 *
 * @param {String} txt
 *   Message to display
 * @param {String} mode
 *   Optional extra class to add to message element
 */
function setMessage(txt, mode){
  if (txt) {
    $('b', $stat).text(txt);
  }

  if (mode) {
    $stat.attr('class', mode);
  }

}

/**
 * Set modal status
 *
 * @param {Boolean} toggle
 *   True for modal overlay on, false for off.
 */
function setModal(toggle){
  if (toggle) {
    $('#modalmask').fadeIn('slow');
  } else {
    $('#modalmask').fadeOut('slow');
  }

  isModal = toggle;
}

/**
 * Simple wrapper to pull out current bot from storage
 *
 * @returns {Object}
 *   Current/default from storage
 */
function getCurrentBot() {
  var bot = {type: 'watercolorbot', name: 'WaterColorBot'};

  try {
    bot = JSON.parse(localStorage['currentBot']);
  } catch(e) {
    // Parse error.. will stick with default
  }
  return bot;
}
