//custom max min header filter
var minMaxFilterEditor = function (
  cell,
  onRendered,
  success,
  cancel,
  editorParams
) {
  var end;

  var container = document.createElement("span");

  //create and style inputs
  var start = document.createElement("input");
  start.setAttribute("type", "number");
  start.setAttribute("placeholder", "Min");
  start.setAttribute("min", 0);
  start.setAttribute("max", 100);
  start.style.padding = "4px";
  start.style.width = "50%";
  start.style.boxSizing = "border-box";

  start.value = cell.getValue();

  function buildValues() {
    success({
      start: start.value,
      end: end.value,
    });
  }

  function keypress(e) {
    if (e.keyCode == 13) {
      buildValues();
    }

    if (e.keyCode == 27) {
      cancel();
    }
  }

  end = start.cloneNode();
  end.setAttribute("placeholder", "Max");

  start.addEventListener("change", buildValues);
  start.addEventListener("blur", buildValues);
  start.addEventListener("keydown", keypress);

  end.addEventListener("change", buildValues);
  end.addEventListener("blur", buildValues);
  end.addEventListener("keydown", keypress);

  container.appendChild(start);
  container.appendChild(end);

  return container;
};

//custom max min filter function
function minMaxFilterFunction(headerValue, rowValue, rowData, filterParams) {
  //headerValue - the value of the header filter element
  //rowValue - the value of the column in this row
  //rowData - the data for the row being filtered
  //filterParams - params object passed to the headerFilterFuncParams property

  if (rowValue) {
    if (headerValue.start != "") {
      if (headerValue.end != "") {
        return rowValue >= headerValue.start && rowValue <= headerValue.end;
      } else {
        return rowValue >= headerValue.start;
      }
    } else {
      if (headerValue.end != "") {
        return rowValue <= headerValue.end;
      }
    }
  }

  return true; //must return a boolean, true if it passes the filter.
}

function add_preset(viewname) {
  let name = prompt("Name of new preset");
  if (!name) return;
  const preset = {};
  $(".tabShowHideCols")
    .find("input[data-fieldname]")
    .each(function () {
      preset[$(this).attr("data-fieldname")] = !!$(this).prop("checked");
    });
  view_post(viewname, "add_preset", {
    name,
    preset,
  });
}

function delete_preset(viewname, name) {
  view_post(viewname, "delete_preset", {
    name,
  });
}

function activate_preset(encPreset) {
  const preset = JSON.parse(decodeURIComponent(encPreset));
  $(".tabShowHideCols")
    .find("input[data-fieldname]")
    .each(function () {
      const name = $(this).attr("data-fieldname");
      const do_show = preset[name];
      if (do_show) window.tabulator_table.showColumn(name);
      else window.tabulator_table.hideColumn(name);
      $(this).prop("checked", do_show);
    });
}
