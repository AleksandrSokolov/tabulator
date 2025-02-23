const Field = require("@saltcorn/data/models/field");
const User = require("@saltcorn/data/models/user");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");

const Table = require("@saltcorn/data/models/table");
const Trigger = require("@saltcorn/data/models/trigger");
const { getState, features } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Workflow = require("@saltcorn/data/models/workflow");
const { eval_expression } = require("@saltcorn/data/models/expression");

const {
  field_picker_fields,
  picked_fields_to_query,
  stateFieldsToWhere,
  initial_config_all_fields,
  stateToQueryString,
  stateFieldsToQuery,
  link_view,
  getActionConfigFields,
  readState,
  run_action_column,
} = require("@saltcorn/data/plugin-helper");
const {
  text,
  div,
  h5,
  style,
  a,
  script,
  pre,
  domReady,
  button,
  i,
  form,
  input,
  label,
  text_attr,
  select,
  option,
} = require("@saltcorn/markup/tags");
const { post_btn, localeDate, localeDateTime } = require("@saltcorn/markup");

const {
  action_url,
  view_linker,
  parse_view_select,
  action_link,
  make_link,
  splitUniques,
} = require("@saltcorn/data/base-plugin/viewtemplates/viewable_fields");

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "views",
        form: async (context) => {
          return new Form({
            fields: [
              {
                name: "stylesheet",
                label: "Stylesheet",
                type: "String",
                required: true,
                attributes: {
                  options: [
                    "bootstrap5",
                    "bootstrap4",
                    "midnight",
                    "modern",
                    "simple",
                    "site",
                  ],
                },
              },
            ],
          });
        },
      },
    ],
  });

const view_configuration_workflow = (req) =>
  new Workflow({
    steps: [
      {
        name: "Columns",
        form: async (context) => {
          const table = await Table.findOne(
            context.table_id
              ? { id: context.table_id }
              : { name: context.exttable_name }
          );
          //console.log(context);
          const field_picker_repeat = await field_picker_fields({
            table,
            viewname: context.viewname,
            req,
          });
          field_picker_repeat.push({
            name: "frozen",
            label: "Frozen",
            type: "Bool",
          });
          field_picker_repeat.push({
            name: "disable_edit",
            label: "Disable editing",
            type: "Bool",
            showIf: { type: "Field" },
          });
          field_picker_repeat.push({
            name: "column_calculation",
            label: "Column Calculation",
            type: "String",
            attributes: {
              options: [
                "avg",
                "max",
                "min",
                "sum",
                "count",
                { name: "__tabulator_colcalc_unique", label: "count unique" },
                { name: "__tabulator_colcalc_counttrue", label: "count true" },
                {
                  name: "__tabulator_colcalc_countfalse",
                  label: "count false",
                },
                {
                  name: "__tabulator_colcalc_avgnonulls",
                  label: "avg no nulls",
                },
              ],
            },
          });
          field_picker_repeat.push({
            name: "calc_dps",
            label: "Calculation decimal places",
            type: "Integer",
            showIf: {
              column_calculation: [
                "avg",
                "max",
                "min",
                "sum",
                "__tabulator_colcalc_avgnonulls",
              ],
            },
          });
          const use_field_picker_repeat = field_picker_repeat.filter(
            (f) => !["state_field", "col_width_units"].includes(f.name)
          );
          field_picker_repeat.find((c) => c.name === "col_width").label =
            "Column width (px)";
          const fvs = field_picker_repeat.filter((c) => c.name === "fieldview");
          fvs.forEach((fv) => {
            if (fv?.attributes?.calcOptions?.[1])
              Object.values(fv.attributes.calcOptions[1]).forEach((fvlst) => {
                if (fvlst[0] === "as_text") fvlst.push("textarea");
              });
          });
          // fix legacy values missing view_name
          (context?.columns || []).forEach((column) => {
            if (
              column.type === "ViewLink" &&
              column.view &&
              !column.view_name
            ) {
              const view_select = parse_view_select(column.view);
              column.view_name = view_select.viewname;
            }
          });
          return new Form({
            fields: [
              new FieldRepeat({
                name: "columns",
                fancyMenuEditor: true,
                fields: use_field_picker_repeat,
              }),
            ],
          });
        },
      },
      {
        name: "Options",
        form: async (context) => {
          const table = await Table.findOne(
            context.table_id
              ? { id: context.table_id }
              : { name: context.exttable_name }
          );
          const fields = await table.getFields();
          for (const field of fields) {
            await field.fill_fkey_options();
          }
          const { tabcolumns } = await get_tabulator_columns(
            context.viewname,
            table,
            fields,
            context.columns,
            false,
            undefined,
            false
          );
          const colFields = tabcolumns
            .filter((c) =>
              ["Field", "JoinField", "Aggregation", "FormulaValue"].includes(
                c.type
              )
            )
            .map((c) => c.field)
            .filter((s) => s);
          const groupByOptions = new Set([
            ...colFields,
            ...fields.map((f) => f.name),
            "Selected by user",
          ]);
          const boolGroupOptions = new Set([
            ...fields
              .filter((f) => f?.type?.name === "Bool")
              .map((f) => f.name),
            ...colFields
              .filter((f) => f.formatter === "tickCross")
              .map((f) => f.field),
          ]);
          const roles = await User.get_roles();
          let tree_field_options = [];
          //self join
          for (const field of fields) {
            if (field.is_fkey && field.reftable_name == table.name)
              tree_field_options.push(field.name);
          }

          const action_options = (
            await Trigger.find({
              when_trigger: { or: ["API call", "Never"] },
            })
          ).map((tr) => tr.name);

          return new Form({
            fields: [
              {
                name: "fit",
                label: "Layout Fit",
                type: "String",
                required: true,
                attributes: {
                  options: [
                    "Columns",
                    "Data",
                    "DataFill",
                    "DataStretch",
                    "DataTable",
                  ],
                },
              },
              {
                name: "groupBy",
                label: "Group by",
                type: "String",
                attributes: {
                  options: [...groupByOptions],
                },
              },
              {
                name: "default_group_by",
                label: "Default group by",
                type: "String",
                attributes: {
                  options: [...groupByOptions].filter(
                    (f) => f !== "Selected by user"
                  ),
                },
                showIf: { groupBy: "Selected by user" },
              },
              {
                name: "group_true_label",
                label: "Group True label",
                type: "String",
                showIf: { groupBy: [...boolGroupOptions] },
              },
              {
                name: "group_false_label",
                label: "Group False label",
                type: "String",
                showIf: { groupBy: [...boolGroupOptions] },
              },
              {
                name: "group_null_label",
                label: "Group null label",
                type: "String",
                showIf: { groupBy: [...boolGroupOptions] },
              },
              {
                name: "group_order_desc",
                label: "Group order descending",
                type: "Bool",
                showIf: { groupBy: [...groupByOptions] },
              },
              {
                name: "tree_field",
                label: "Tree field",
                type: "String",
                attributes: {
                  options: tree_field_options,
                },
              },
              {
                name: "def_order_field",
                label: req.__("Default order by"),
                type: "String",
                attributes: {
                  options: fields.map((f) => f.name),
                },
              },
              {
                name: "def_order_descending",
                label: req.__("Default order descending?"),
                type: "Bool",
              },
              {
                name: "hideColsBtn",
                label: "Show/hide columns",
                type: "Bool",
                sublabel: "Display drop-down menu to select shown columns",
              },
              {
                name: "column_visibility_presets",
                label: "Column visibility presets",
                type: "Bool",
                showIf: { hideColsBtn: true },
              },
              {
                name: "min_role_preset_edit",
                label: "Role to edit",
                sublabel: "Role required to edit presets",
                input_type: "select",
                showIf: { hideColsBtn: true, column_visibility_presets: true },
                options: roles.map((r) => ({ value: r.id, label: r.role })),
              },
              {
                name: "hide_null_columns",
                label: "Hide null columns",
                sublabel:
                  "Do not display a column if it contains entirely missing values",
                type: "Bool",
              },
              {
                name: "addRowBtn",
                label: "Add row button",
                type: "Bool",
              },
              {
                name: "selectable",
                label: "Selectable",
                type: "Bool",
              },
              {
                name: "remove_unselected_btn",
                label: "Show selection button",
                type: "Bool",
                showIf: { selectable: true },
              },
              {
                name: "download_csv",
                label: "Download CSV",
                type: "Bool",
              },
              {
                name: "header_filters",
                label: "Header filters",
                type: "Bool",
              },
              {
                name: "movable_cols",
                label: "Movable columns",
                type: "Bool",
              },
              {
                name: "vert_col_headers",
                label: "Vertical column headers",
                type: "Bool",
              },
              {
                name: "history",
                label: "History (undo/redo)",
                type: "Bool",
              },
              {
                name: "persistent",
                label: "Persistent configuration",
                type: "Bool",
              },
              {
                name: "reset_persistent_btn",
                label: "Reset persistent button",
                sublabel: "Show button to reset persistent configuration",
                type: "Bool",
                showIf: { persistent: true },
              },
              {
                name: "dropdown_frozen",
                label: "Action dropdown column frozen",
                type: "Bool",
              },
              {
                name: "pagination_enabled",
                label: "Pagination",
                type: "Bool",
              },
              {
                name: "pagination_size",
                label: "Pagination size",
                type: "Integer",
                default: 20,
                showIf: { pagination_enabled: true },
              },
              {
                name: "selected_rows_action",
                label: "Selected rows action",
                type: "String",
                attributes: {
                  options: [...action_options],
                },
              },
              {
                name: "selected_rows_action_once",
                label: "Run action once for all rows",
                type: "Bool",
                sublabel:
                  "Tick to run action once with all rows (<code>rows</code> variable). Untick to run multiple times, once for each row (<code>row</code> variable).",
                showIf: { selected_rows_action: [...action_options] },
              },
            ],
          });
        },
      },
    ],
  });

const get_state_fields = async (table_id, viewname, { show_view }) => {
  const table_fields = await Field.find({ table_id });
  return table_fields
    .filter((f) => !f.primary_key)
    .map((f) => {
      const sf = new Field(f);
      sf.required = false;
      return sf;
    });
};
//copy from server/routes/list.js
const typeToGridType = (t, field, header_filters, column, calculators) => {
  const jsgField = { field: field.name, title: field.label, editor: true };
  if (t.name === "String" && field.attributes && field.attributes.options) {
    jsgField.editor = "select";

    const values = field.attributes.options.split(",").map((o) => o.trim());
    if (!field.required) values.unshift("");

    jsgField.editorParams = { values };
    if (header_filters) jsgField.headerFilterParams = { values };
    jsgField.headerFilter = !!header_filters;
  } else if (t.name === "String") {
    jsgField.headerFilter = !!header_filters;
    if (column.fieldview === "textarea") {
      jsgField.formatter = "textarea";
      jsgField.editor = false;
      if (jsgField.headerFilter) jsgField.headerFilter = "input";
    }
  } else if (t === "Key" || t === "File") {
    if (field.fieldview === "Thumbnail") {
      jsgField.formatter = "__optionalImageFormatter";
      jsgField.formatterParams = {
        height: field.attributes?.height
          ? `${field.attributes?.height || 50}px`
          : undefined,
        width: `${field.attributes?.width || 50}px`,
        urlPrefix: "/files/resize/",
        urlSuffix:
          `/${field.attributes?.width || 50}` +
          (field.attributes?.height ? `/${field.attributes.height}` : ""),
      };
      jsgField.editor = false;
    } else {
      jsgField.editor = "select";
      const values = {};
      //console.log(column);
      (field.options || []).forEach(
        ({ label, value }) => (values[value] = label)
      );
      calculators.push((row) => {
        if (row[field.name]) row[field.name] = `${row[field.name]}`;
      });
      jsgField.editorParams = { values };
      jsgField.formatterParams = { values };
      if (header_filters) jsgField.headerFilterParams = { values };
      jsgField.formatter = "__lookupIntToString";
      jsgField.headerFilter = !!header_filters;
      jsgField.headerFilterFunc = "=";
    }
  } else if (t.name === "Float" || t.name === "Integer") {
    jsgField.editor = "number";
    jsgField.sorter = "number";
    jsgField.hozAlign = "right";
    jsgField.headerHozAlign = "right";
    jsgField.editorParams = {
      step: t.name === "Integer" ? 1 : undefined,
      min:
        typeof field.attributes.min !== "undefined"
          ? field.attributes.min
          : undefined,
      max:
        typeof field.attributes.max !== "undefined"
          ? field.attributes.max
          : undefined,
    };
    jsgField.headerFilter = !!header_filters && "__minMaxFilterEditor";
    jsgField.headerFilterFunc = "__minMaxFilterFunction";
    jsgField.headerFilterLiveFilter = false;
    if (field.fieldview === "show_star_rating") {
      jsgField.formatter = "star";
      jsgField.formatterParams = {
        stars: (field.attributes?.max || 5) - (field.attributes?.min || 1) + 1,
      };
      jsgField.editor = "star";
    }
  } else if (t.name === "Bool") {
    jsgField.editor = "tickCross";
    jsgField.formatter = "tickCross";
    jsgField.hozAlign = "center";
    jsgField.vertAlign = "center";
    jsgField.editorParams = field.required ? {} : { tristate: true };
    jsgField.formatterParams = field.required ? {} : { allowEmpty: true };
    jsgField.headerFilter = !!header_filters;
  } else if (t.name === "Date") {
    jsgField.sorter = "date";

    jsgField.sorter = "date";
    jsgField.sorterParams = {
      format: "iso",
    };
    jsgField.editor = "__flatpickerEditor";

    if (field.fieldview === "showDay") {
      jsgField.editorParams = { dayOnly: true };
      jsgField.formatter = "__isoDateFormatter";
    } else if (field.fieldview === "format") {
      jsgField.formatter = "__isoDateFormatter";
      jsgField.formatterParams = {
        format: field.attributes.format,
      };
    } else {
      jsgField.formatter = "datetime";
      jsgField.formatterParams = {
        inputFormat: "iso",
      };
    }
    jsgField.headerFilter = !!header_filters && "__dateFilterEditor";
    jsgField.headerFilterFunc = "__dateFilterFunction";
    jsgField.headerFilterLiveFilter = false;
  } else if (t.name === "Color") {
    jsgField.editor = "__colorEditor";
    jsgField.formatter = "__colorFormatter";
    jsgField.hozAlign = "center";
    jsgField.vertAlign = "center";
  } else if (t.name === "JSON") {
    if (field.fieldview === "keys_expand_columns") {
      const fv = t.fieldviews.keys_expand_columns;
      const ex = fv.expandColumns(field, column, column);
      jsgField.subcolumns = ex;
      jsgField.field = field;
    } else {
      jsgField.formatter = "__jsonFormatter";
      jsgField.editor = "__jsonEditor";
    }
  } else if (t.name === "SharedFileLink") {
    //console.log(t, column);
    jsgField.formatter = "html";
    const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
    const fv = t.fieldviews[column.fieldview];

    calculators.push((row) => {
      row[rndid] =
        fv && row[column.field_name]
          ? fv.run(row[column.field_name], undefined, field.attributes)
          : "";
    });
    jsgField.field = rndid;
    jsgField.clipboard = false;
    jsgField.headerFilter = !!header_filters && "input";
    jsgField.editor = false;
  }

  if (field.calculated) {
    jsgField.editor = false;
  }
  if (field.primary_key) {
    jsgField.editor = false;
  }
  return jsgField;
};

const set_join_fieldviews = async ({ columns, fields }) => {
  for (const segment of columns) {
    const { join_field, join_fieldview, type } = segment;
    if (!join_fieldview || type !== "JoinField") continue;
    const keypath = join_field.split(".");

    let field,
      theFields = fields;
    for (let i = 0; i < keypath.length; i++) {
      const refNm = keypath[i];
      field = theFields.find((f) => f.name === refNm);
      if (!field || !field.reftable_name) break;
      const table = await Table.findOne({ name: field.reftable_name });
      if (!table) break;
      theFields = await table.getFields();
    }
    if (!field) continue;
    segment.field_obj = field;
    if (field && field.type === "File") segment.field_type = "File";
    else if (
      field?.type.name &&
      field.type.fieldviews &&
      field.type.fieldviews[join_fieldview]
    ) {
      segment.field_type = field.type.name;
      segment.fieldview = join_fieldview;
    }
  }
};

const set_json_col = (tcol, field, key, header_filters) => {
  if (field?.attributes?.hasSchema && field.attributes.schema) {
    const schemaType = field.attributes.schema.find((t) => t.key === key);
    //console.log(schemaType);
    switch (schemaType?.type) {
      case "Integer":
      case "Float":
        tcol.sorter = "number";
        tcol.hozAlign = "right";
        tcol.headerHozAlign = "right";
        tcol.headerFilter = header_filters && "__minMaxFilterEditor";
        tcol.headerFilterFunc = "__minMaxFilterFunction";
        tcol.headerFilterLiveFilter = false;
        break;
      case "String":
        tcol.headerFilter = header_filters && "input";
        break;
      case "Bool":
        tcol.formatter = "tickCross";
        tcol.hozAlign = "center";
        tcol.vertAlign = "center";
        break;
      default:
        break;
    }
    if (schemaType?.type.startsWith("Key to")) {
      tcol.headerFilter = header_filters && "input";

      tcol.lookupFkeys = {
        table: schemaType.type.replace("Key to ", ""),
        field: schemaType.summary_field,
      };
    }
  }
};

const get_tabulator_columns = async (
  viewname,
  table,
  fields,
  columns,
  isShow,
  req,
  header_filters,
  vert_col_headers,
  dropdown_frozen
) => {
  const tabcols = [];
  const calculators = [];
  const dropdown_actions = [];
  for (const column of columns) {
    let tcol = {};
    if (column.type === "Field") {
      let f = fields.find((fld) => fld.name === column.field_name);
      if (!f) return {};
      Object.assign(f.attributes, column);
      f.fieldview = column.fieldview;
      if (column.fieldview === "subfield") {
        tcol.editor = false;
        const key = `${column.field_name}_${column.key}`;
        calculators.push((row) => {
          row[key] = (row[column.field_name] || {})[column.key];
        });
        tcol.field = key;
        tcol.title = column.key;
        tcol.headerFilter = !!header_filters;
        set_json_col(tcol, f, column.key, header_filters);
      } else
        tcol = typeToGridType(f.type, f, header_filters, column, calculators);
    } else if (column.type === "JoinField") {
      let refNm, targetNm, through, key, type;
      if (column.join_field.includes("->")) {
        const [relation, target] = column.join_field.split("->");
        const [ontable, ref] = relation.split(".");
        targetNm = target;
        refNm = ref;
        key = `${ref}_${ontable}_${target}`;
      } else {
        const keypath = column.join_field.split(".");
        refNm = keypath[0];
        targetNm = keypath[keypath.length - 1];
        key = keypath.join("_");
      }
      if (column.field_type && column.field_obj) {
        tcol = typeToGridType(
          getState().types[column.field_type],
          column.field_obj,
          header_filters,
          column,
          calculators
        );
      }
      tcol.field = key;
      tcol.editor = false;
    } else if (column.type === "Aggregation") {
      let table, fld, through;
      const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
      if (column.agg_relation.includes("->")) {
        let restpath;
        [through, restpath] = column.agg_relation.split("->");
        [table, fld] = restpath.split(".");
      } else {
        [table, fld] = column.agg_relation.split(".");
      }
      const targetNm = db.sqlsanitize(
        (
          column.stat.replace(" ", "") +
          "_" +
          table +
          "_" +
          fld +
          db.sqlsanitize(column.aggwhere || "")
        ).toLowerCase()
      );
      tcol.formatter = "html";
      let showValue = (value) => {
        if (value === true)
          return i({
            class: "fas fa-lg fa-check-circle text-success",
          });
        else if (value === false)
          return i({
            class: "fas fa-lg fa-times-circle text-danger",
          });
        if (value instanceof Date) return localeDateTime(value);
        if (Array.isArray(value))
          return value.map((v) => showValue(v)).join(", ");
        return value?.toString ? value.toString() : value;
      };
      if (column.agg_fieldview && column.agg_field?.includes("@")) {
        const tname = column.agg_field.split("@")[1];
        const type = getState().types[tname];
        if (type?.fieldviews[column.agg_fieldview])
          showValue = (x) =>
            type.fieldviews[column.agg_fieldview].run(x, req, column);
      }
      calculators.push((row) => {
        let value = row[targetNm];

        row[rndid] = showValue(value);
      });
      tcol.field = rndid; //db.sqlsanitize(targetNm);
    } else if (column.type === "FormulaValue") {
      const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
      calculators.push((row) => {
        row[rndid] = eval_expression(column.formula, row);
      });
      tcol.field = rndid;
      tcol.headerFilter = !!header_filters && "input";
    } else if (column.type === "ViewLink") {
      tcol.formatter = "html";
      const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
      const { key } = view_linker(column, fields);
      calculators.push((row) => {
        row[rndid] = key(row);
      });
      tcol.field = rndid;
      tcol.clipboard = false;
      tcol.headerFilter = !!header_filters && "input";
      if (column.in_dropdown) {
        dropdown_actions.push({
          column,
          rndid,
          wholeLink: true,
          label: column.label || column.action_name,
        });
        tcol = false;
      }
    } else if (column.type === "Link") {
      tcol.formatter = "html";
      const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);

      const { key } = make_link(column, fields);
      calculators.push((row) => {
        row[rndid] = key(row);
      });
      tcol.field = rndid;
      tcol.clipboard = false;
      tcol.headerFilter = !!header_filters && "input";
      if (column.in_dropdown) {
        dropdown_actions.push({
          column,
          rndid,
          wholeLink: true,
          label: column.label || column.action_name,
        });
        tcol = false;
      }
    } else if (
      column.type === "Action" &&
      column.action_name === "Delete" &&
      !column.in_dropdown
    ) {
      tcol = {
        formatter: "buttonCross",
        title: i({ class: "far fa-trash-alt" }),
        width: 40,
        formatterParams: { confirm: column.confirm, tableName: table.name },
        hozAlign: "center",
        headerSort: false,
        clipboard: false,
        cellClick: "__delete_tabulator_row",
      };
    } else if (column.type === "Action") {
      tcol.formatter = "html";
      //console.log(column);
      const rndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
      calculators.push((row) => {
        const url = action_url(
          viewname,
          table,
          column.action_name,
          row,
          column.action_name,
          "action_name"
        );
        const action_label = column.action_label_formula
          ? eval_expression(column.action_label, row)
          : column.action_label || column.action_name;
        row[rndid] = column.in_dropdown
          ? url
          : action_link(url, req, { ...column, action_label });
      });
      tcol.field = rndid;
      tcol.clipboard = false;
      if (column.in_dropdown) {
        dropdown_actions.push({
          column,
          rndid,
          label: column.label || column.action_name,
        });
        tcol = false;
      }
    }
    if (!tcol) continue;
    if (tcol.subcolumns) {
      for (const { label, row_key } of tcol.subcolumns) {
        const [fld, subfld] = row_key;
        const scol = {};
        scol.editor = false;
        const key = `${fld}_${subfld}`;
        calculators.push((row) => {
          row[key] = (row[fld] || {})[subfld];
        });
        scol.field = key;
        scol.title = subfld;
        set_json_col(scol, tcol.field, subfld, header_filters);
        tabcols.push(scol);
      }
      continue;
    }
    if (column.header_label) tcol.title = column.header_label;
    if (column.frozen) tcol.frozen = true;
    if (column.disable_edit) tcol.editor = false;
    if (vert_col_headers) tcol.headerVertical = true;
    if (column.column_calculation) {
      tcol.bottomCalc = column.column_calculation;
      if (column.calc_dps)
        tcol.bottomCalcParams = { precision: column.calc_dps };
    }
    if (column.col_width) tcol.width = column.col_width;
    tabcols.push(tcol);
  }
  let arndid;

  if (dropdown_actions.length > 0) {
    arndid = "col" + Math.floor(Math.random() * 16777215).toString(16);
    calculators.push((row) => {
      let html = "";
      row[arndid] = button(
        {
          class: "btn btn-sm btn-xs btn-outline-secondary dropdown-toggle",
          disabled: true,
        },
        "Action"
      );
      dropdown_actions.forEach(({ label, column, rndid, wholeLink }) => {
        const action = row[rndid];
        if (action.javascript)
          html += a({ href: `javascript:${action.javascript}` }, label);
        else if (wholeLink) html += action;
        else
          html += post_btn(action, label, req.csrfToken(), {
            small: true,
            ajax: true,
            reload_on_done: true,
            btnClass: "dropdown-item",
            confirm: column.confirm,
            req,
          });
      });
      row._dropdown = html;
    });
    //const values = {};
    //dropdown_actions.forEach(({ label, rndid }) => {
    //  values[rndid] = label;
    //});

    tabcols.push({
      field: arndid,
      title: "Actions",
      clipboard: false,
      //editorParams: { values },
      formatter: "html",
      headerSort: false,
      clickPopup: "__actionPopup",
      frozen: !!dropdown_frozen,
    });
  }
  return {
    tabcolumns: tabcols,
    calculators,
    dropdown_id: arndid,
    dropdown_actions,
  };
};

const addRowButton = (rndid) =>
  button(
    {
      class: "btn btn-sm btn-primary mx-1",
      onClick: `add_tabview_row('${rndid}')`,
    },
    i({ class: "fas fa-plus me-1" }),
    "Add row"
  );

const selectGroupBy = (
  fields,
  columns,
  rndid,
  orderFld,
  orderDesc,
  default_group_by
) => {
  const groupByOptions = {};
  columns.forEach((c) => {
    if (["Field", "JoinField", "Aggregation"].includes(c.type) && c.field)
      groupByOptions[c.field] = c.title || c.field;
  });
  fields.forEach((f) => {
    groupByOptions[f.name] = f.label || f.name;
  });

  return select(
    {
      onChange: `tabUserGroupBy(this, '${rndid}'${
        orderFld ? `, '${orderFld}', ${!!orderDesc}` : ""
      })`,
      class: "mx-1 form-select d-inline",
      style: "width:unset",
    },
    option(
      { value: "", disabled: true, selected: !default_group_by },
      "Group by..."
    ),
    option({ value: "" }, "No grouping"),
    Object.entries(groupByOptions).map(([k, v]) =>
      option({ value: k, selected: k === default_group_by }, v)
    )
  );
};

const hideShowColsBtn = (
  tabcolumns,
  column_visibility_presets,
  presets,
  can_edit,
  viewname,
  rndid
) =>
  div(
    { class: "dropdown d-inline mx-1" },
    button(
      {
        class: "btn btn-sm btn-outline-secondary dropdown-toggle",
        "data-boundary": "viewport",
        type: "button",
        id: "btnHideCols",
        "data-bs-toggle": "dropdown",
        "aria-haspopup": "true",
        "aria-expanded": "false",
      },
      "Show/hide fields"
    ),
    div(
      {
        class: "dropdown-menu",
        "aria-labelledby": "btnHideCols",
      },
      form(
        { class: "px-2 tabShowHideCols" },
        a({ onclick: `allnonecols(true,this)`, href: "javascript:;" }, "All"),
        " | ",
        a({ onclick: `allnonecols(false,this)`, href: "javascript:;" }, "None"),
        !!column_visibility_presets && div("Presets:"),
        column_visibility_presets &&
          Object.entries(presets || {}).map(([k, v]) =>
            div(
              a(
                {
                  href: `javascript:activate_preset('${encodeURIComponent(
                    JSON.stringify(v)
                  )}', '${rndid}');`,
                },
                k
              ),
              can_edit &&
                a(
                  {
                    href: `javascript:delete_preset('${viewname}','${k}');`,
                  },
                  i({ class: "fas fa-trash-alt" })
                )
            )
          ),
        can_edit &&
          !!column_visibility_presets &&
          a(
            {
              class: "d-block",
              href: `javascript:add_preset('${viewname}');`,
            },
            i({ class: "fas fa-plus" }),
            "Add"
          ),

        tabcolumns.map(
          (f) =>
            f.field &&
            !f.frozen &&
            div(
              { class: "form-check" },
              input({
                type: "checkbox",
                onChange: `showHideColView('${f.field}', this, '${rndid}')`,
                class: "form-check-input",
                checked: true,
                "data-fieldname": f.field,
              }),
              label(f.title || f.field)
            )
        )
      )
    )
  );
const run = async (
  table_id,
  viewname,
  {
    columns,
    fit,
    hideColsBtn,
    hide_null_columns,
    addRowBtn,
    selectable,
    remove_unselected_btn,
    download_csv,
    header_filters,
    pagination_enabled,
    pagination_size,
    movable_cols,
    history,
    persistent,
    groupBy,
    dropdown_frozen,
    vert_col_headers,
    reset_persistent_btn,
    def_order_field,
    def_order_descending,
    column_visibility_presets,
    presets,
    min_role_preset_edit,
    tree_field,
    selected_rows_action,
    group_true_label,
    group_false_label,
    group_null_label,
    default_group_by,
    group_order_desc,
  },
  state,
  extraArgs
) => {
  const table = await Table.findOne({ id: table_id });
  const fields = await table.getFields();
  for (const field of fields) {
    await field.fill_fkey_options();
  }
  readState(state, fields);
  const where = await stateFieldsToWhere({ fields, state });
  const q = await stateFieldsToQuery({ state, fields, prefix: "a." });
  //const rows_per_page = default_state && default_state._rows_per_page;
  //if (!q.limit && rows_per_page) q.limit = rows_per_page;
  if (!q.orderBy) q.orderBy = table.pk_name;
  if (extraArgs.isPreview) q.limit = 20;

  //if (!q.orderDesc) q.orderDesc = default_state && default_state._descending;
  const current_page = parseInt(state._page) || 1;
  const { joinFields, aggregations } = picked_fields_to_query(columns, fields);
  await set_join_fieldviews({ columns, fields });
  let groupBy1 = groupBy;
  if (groupBy1) {
    if (groupBy === "Selected by user" && default_group_by)
      groupBy1 = default_group_by;
    const groupField = fields.find((f) => f.name === groupBy1);
    if (groupField && groupField.is_fkey) {
      let orginalName = groupBy1;
      groupBy1 = `${groupBy1}_${groupField?.attributes?.summary_field || "id"}`;
      if (!joinFields[groupBy1])
        joinFields[groupBy1] = {
          ref: orginalName,
          target: groupField?.attributes?.summary_field || "id",
        };
    }
  }

  // console.log(aggregations);

  let rows = await table.getJoinedRows({
    where,
    joinFields,
    aggregations,
    ...q,
  });
  //console.log(rows[0]);
  //console.log(columns[0]);
  //console.log({ rows_len: rows.length, q, where, rows_per_page });
  const { tabcolumns, calculators, dropdown_id, dropdown_actions } =
    await get_tabulator_columns(
      viewname,
      table,
      fields,
      columns,
      false,
      extraArgs.req,
      header_filters,
      vert_col_headers,
      dropdown_frozen
    );
  calculators.forEach((f) => {
    rows.forEach(f);
  });
  if (selectable)
    tabcolumns.unshift({
      formatter: "rowSelection",
      titleFormatter: "rowSelection",
      headerSort: false,
      width: "20",
      clipboard: false,
      frozen: tabcolumns[0].frozen,
    });
  const use_tabcolumns = hide_null_columns
    ? tabcolumns.filter(
        (c) =>
          !c.field ||
          rows.some(
            (row) =>
              row[c.field] !== null && typeof row[c.field] !== "undefined"
          )
      )
    : tabcolumns;
  if (tree_field) {
    const my_ids = new Set(rows.map((r) => r.id));
    for (const row of rows) {
      if (row[tree_field] && my_ids.has(row[tree_field]))
        row._parent = row[tree_field];
      else row._parent = null;
    }
    //https://stackoverflow.com/a/55241491
    const nest = (items, id = null) =>
      items
        .filter((item) => item._parent === id)
        .map((item) => ({ ...item, _children: nest(items, item.id) }));
    //const old_rows = [...rows];
    rows = nest(rows);
  }
  if (groupBy1 && def_order_field) {
    const dir = def_order_descending ? -1 : 1;
    const dirGroup = group_order_desc ? -1 : 1;

    rows.sort((a, b) =>
      a[groupBy1] > b[groupBy1]
        ? dirGroup
        : b[groupBy1] > a[groupBy1]
        ? -1 * dirGroup
        : a[def_order_field] > b[def_order_field]
        ? dir
        : b[def_order_field] > a[def_order_field]
        ? -1 * dir
        : 0
    );
  } else if (groupBy1) {
    const dir = group_order_desc ? -1 : 1;

    rows.sort((a, b) =>
      a[groupBy1] > b[groupBy1] ? dir : b[groupBy1] > a[groupBy1] ? -1 * dir : 0
    );
  }
  const pgSz = pagination_size || 20;
  const paginationSizeChoices = [
    Math.round(pgSz / 2),
    Math.round(pgSz * 0.75),
    pgSz,
    Math.round(pgSz * 1.5),
    pgSz * 2,
    pgSz * 3,
    true,
  ];
  const hasCalculated = fields.some((f) => f.calculated);
  const selected_rows_action_name = selected_rows_action
    ? ((x) => x?.description || x?.name)(
        getState().triggers.find((tr) => tr.name === selected_rows_action)
      ) || selected_rows_action
    : "";

  const rndid = Math.floor(Math.random() * 16777215).toString(16);
  for (const col of use_tabcolumns) {
    if (col.lookupFkeys) {
      const table = Table.findOne(col.lookupFkeys.table);
      const ids = [...new Set(rows.map((r) => r[col.field]).filter((x) => x))];
      const lu_map = {};
      (await table.getRows({ id: { in: ids } })).forEach((r) => {
        lu_map[r.id] = r;
      });
      rows.forEach((r) => {
        if (r[col.field] && lu_map[r[col.field]])
          r[col.field] = lu_map[r[col.field]][col.lookupFkeys.field];
      });
    }
  }
  return fragment(
    //script(`var edit_fields=${JSON.stringify(jsfields)};`),
    //script(domReady(versionsField(table.name))),
    style(`.tabulator-popup-container {background: white}`),
    script(
      domReady(`
      const columns=${JSON.stringify(use_tabcolumns)};   
      const dropdown_actions = ${JSON.stringify(dropdown_actions)};
      window.actionPopup = (e, row) => {
        return row.getRow().getData()._dropdown;
      }     
      columns.forEach(col=>{
        Object.entries(col).forEach(([k,v])=>{
          if(typeof v === "string" && v.startsWith("__")) {
            col[k] = window[v.substring(2)];
          }
        })
      })
    window.tabulator_table_${rndid} = new Tabulator("#tabgrid${viewname}", {
        data: ${JSON.stringify(rows)},
        layout:"fit${fit || "Columns"}", 
        columns,
        height:"100%",
        pagination:${!!pagination_enabled},
        paginationSize:${pagination_size || 20},
        paginationSizeSelector: ${JSON.stringify(paginationSizeChoices)},
        clipboard:true,
        persistence:${!!persistent}, 
        persistenceID:"tabview_${viewname}",
        movableColumns: ${!!movable_cols},
        history: ${!!history},
        ${
          tree_field
            ? "dataTree:true,dataTreeStartExpanded:true,dataTreeSelectPropagate:true,"
            : ""
        }
        ${
          tree_field && selectable
            ? `dataTreeElementColumn:"${
                use_tabcolumns.find((c) => c.field).field
              }",`
            : ""
        }
        ${
          groupBy1
            ? `groupBy: ${
                group_true_label || group_false_label
                  ? `(data)=>
         data.${groupBy1}===true
         ? "${group_true_label || "True"}"
         : data.${groupBy1}===false
         ? "${group_false_label || "False"}"
         : "${group_null_label || "N/A"}"`
                  : groupBy1 === "Selected by user"
                  ? "false"
                  : `"${groupBy1}"`
              },`
            : ""
        }
        ${
          def_order_field && !groupBy1
            ? `initialSort:[
            
          {column:"${def_order_field}", dir:"${
                def_order_descending ? "desc" : "asc"
              }"},
        ],`
            : ""
        }
        ajaxResponse:function(url, params, response){                    
  
          return response.success; //return the tableData property of a response json object
        },
    });
    function save_row_from_cell( row, cell, noid) {
      const fld = cell.getField()
      if(typeof row[fld]==="undefined") return;
      const saveRow = {[fld]: row[fld]}
       $.ajax({
        type: "POST",
        url: "/api/${table.name}/" + (noid?'':(row.id||"")),
        data: saveRow,
        headers: {
          "CSRF-Token": _sc_globalCsrf,
        },
        error: tabulator_error_handler,
      }).done(function (resp) {
        if(resp.success &&typeof resp.success ==="number" && !row.id && cell) {
          window.tabulator_table_${rndid}.updateRow(cell.getRow(), {id: resp.success});
          
        }
        ${
          hasCalculated
            ? `
        let id = noid ? resp.success : row.id
        $.ajax({
          type: "GET",
          url: "/api/${table.name}?id=" +id,          
          headers: {
            "CSRF-Token": _sc_globalCsrf,
          },
          error: tabulator_error_handler,
        }).done(function (resp) {
          console.log("calc GET",resp)
          if(resp.success && resp.success[0]) {
            window.tabulator_table_${rndid}.updateRow(cell.getRow(), resp.success[0]);
          }
        })
          `
            : ""
        }
      });
    }
    window.tabulator_table_${rndid}.on("cellEdited", function(cell){
      const row=cell.getRow().getData();
      if(cell.getField()==="${dropdown_id}"){
        const val = cell.getValue();
        const action= row[val]
        if(typeof action==="string") {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = action;
          const hiddenField = document.createElement('input');
          hiddenField.type = 'hidden';
          hiddenField.name = '_csrf';
          hiddenField.value = _sc_globalCsrf;
          form.appendChild(hiddenField);
          document.body.appendChild(form);
          form.submit();
        }         
        if(action && action.javascript)
          eval(action.javascript)        
      }
      else save_row_from_cell(row, cell)
    });
    window.tabulator_table_${rndid}.on("historyUndo", function(action, component, data){
      
      switch (action) {
        case "cellEdit": 
          save_row_from_cell(component.getRow().getData(), component)
          break;
        case "rowDelete": 
          const {id, ...delRow} = data.data
          save_row_from_cell( data.data, undefined, true)
          break;
      }
    })
    window.tabulator_table_${rndid}.on("historyRedo", function(action, component, data){
      switch (action) {
        case "cellEdit": 
          save_row_from_cell(component.getRow().getData(), component)
          break;
      }
    })
    window.tabulator_table_name_${rndid}="${table.name}";
    window.tab_remove_unselected = () =>{
      const allRowCount = window.tabulator_table_${rndid}.getDataCount();
      const selRowCount = window.tabulator_table_${rndid}.getDataCount("selected");
      if(selRowCount < allRowCount/2) {
        const rows = window.tabulator_table_${rndid}.getData("selected");
        window.tabulator_table_${rndid}.clearData();
        for(const row of rows) 
          window.tabulator_table_${rndid}.addRow(row);
      } else {
        const selected = new Set(window.tabulator_table_${rndid}.getSelectedRows().map(r=>r.getIndex()));
        const rows = window.tabulator_table_${rndid}.getRows();
        const to_delete=[]
        for(const row of rows) 
          if(!selected.has(row.getIndex())) 
            to_delete.push(row);   
        
        window.tabulator_table_${rndid}.deleteRow(to_delete);
      }
    }
    window.tab_reset_persistcfg = () =>{
      for (const key in localStorage){
        if(key.startsWith('tabulator-tabview_${viewname}-'))
          localStorage.removeItem(key);
      }
      location.reload();
    }
    window.allnonecols= (do_show, e) =>{
      columns.forEach(col=>{
        if (do_show) window.tabulator_table_${rndid}.showColumn(col.field);
        else window.tabulator_table_${rndid}.hideColumn(col.field);
        $(e).closest("form").find("input").prop("checked", do_show)
      })
    }
    ${
      download_csv
        ? `document.getElementById("tabulator-download-csv").addEventListener("click", function(){
            const selectedData = window.tabulator_table_${rndid}.getSelectedData();
            window.tabulator_table_${rndid}.download("csv", "${viewname}.csv",{}, selectedData.length>0 ? "selected" : "all");
          });`
        : ""
    }`)
    ),

    history &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          title: "Undo",
          onClick: `window.tabulator_table_${rndid}.undo()`,
        },
        i({ class: "fas fa-undo" })
      ),
    history &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          title: "Redo",
          onClick: `window.tabulator_table_${rndid}.redo()`,
        },
        i({ class: "fas fa-redo" })
      ),
    groupBy === "Selected by user" &&
      selectGroupBy(
        fields,
        columns,
        rndid,
        def_order_field,
        def_order_descending,
        default_group_by
      ),
    selected_rows_action &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          title: "on selected rows",
          onClick: `run_selected_rows_action('${viewname}', ${selectable}, '${rndid}', ${!!tree_field})`,
        },
        selected_rows_action_name
      ),

    remove_unselected_btn &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          title: "Redo",
          onClick: `tab_remove_unselected()`,
        },
        "Show selection"
      ),
    download_csv &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          id: "tabulator-download-csv",
        },
        i({ class: "fas fa-download me-1" }),
        "Download"
      ),
    reset_persistent_btn &&
      button(
        {
          class: "btn btn-sm btn-primary mx-1",
          title: "Reset",
          onClick: `tab_reset_persistcfg()`,
        },
        "Reset"
      ),
    addRowBtn && addRowButton(rndid),
    hideColsBtn &&
      hideShowColsBtn(
        tabcolumns,
        column_visibility_presets,
        presets,
        extraArgs.req?.user?.role_id || 10 <= (min_role_preset_edit || 1),
        viewname,
        rndid
      ),
    div({ id: "jsGridNotify", class: "my-1" }),

    div({ id: `tabgrid${viewname}` })
  );
};

const add_preset = async (
  table_id,
  viewname,
  { presets, min_role_preset_edit },
  body,
  { req, res }
) => {
  if ((req.user?.role_id || 10) > (min_role_preset_edit || 1)) {
    console.log("not authorized", min_role_preset_edit);
    return;
  }
  const newPresets = presets || {};
  newPresets[body.name] = body.preset;
  const view = await View.findOne({ name: viewname });
  const newConfig = {
    configuration: { ...view.configuration, presets: newPresets },
  };
  await View.update(newConfig, view.id);
};

const delete_preset = async (
  table_id,
  viewname,
  { presets, min_role_preset_edit },
  body,
  { req, res }
) => {
  if ((req.user?.role_id || 10) > +(min_role_preset_edit || 1)) {
    console.log("not authorized");
    return;
  }

  const newPresets = presets || {};
  delete newPresets[body.name];
  const view = await View.findOne({ name: viewname });
  const newConfig = {
    configuration: { ...view.configuration, presets: newPresets },
  };
  await View.update(newConfig, view.id);
};

const run_action = async (
  table_id,
  viewname,
  { columns, layout },
  body,
  { req, res }
) => {
  const col = columns.find(
    (c) =>
      c.type === "Action" &&
      c.action_name === body.action_name &&
      body.action_name
  );
  //console.log({ col, body });
  const table = await Table.findOne({ id: table_id });
  const row = await table.getRow({ id: body.id });
  const state_action = getState().actions[col.action_name];
  col.configuration = col.configuration || {};
  if (state_action) {
    const cfgFields = await getActionConfigFields(state_action, table);
    cfgFields.forEach(({ name }) => {
      col.configuration[name] = col[name];
    });
  }
  try {
    const result = await run_action_column({
      col,
      req,
      res,
      table,
      row,
      user: req.user,
      referrer: req.get("Referrer"),
    });
    return { json: { success: "ok", ...(result || {}) } };
  } catch (e) {
    return { json: { error: e.message || e } };
  }
};

const run_selected_rows_action = async (
  table_id,
  viewname,
  { selected_rows_action, selected_rows_action_once },
  { rows },
  { req, res }
) => {
  const table = await Table.findOne({ id: table_id });

  const trigger = await Trigger.findOne({ name: selected_rows_action });
  if (!trigger)
    return { json: { error: "Trigger not found: " + selected_rows_action } };
  const action = getState().actions[trigger.action];
  if (!action)
    return { json: { error: "Action not found: " + trigger.action } };

  let result;
  const actionArg = {
    referrer: req.get("Referrer"),
    table,
    req,
    Table,
    user: req.user,
    configuration: trigger.configuration,
  };
  if (selected_rows_action_once)
    result = await action.run({
      rows,
      ...actionArg,
    });
  else
    for (const row of rows)
      result = await action.run({
        row,
        ...actionArg,
      });

  return { json: { success: "ok", ...(result || {}) } };
};
module.exports = {
  headers: ({ stylesheet }) => [
    {
      script: `/plugins/public/tabulator${
        features?.version_plugin_serve_path
          ? "@" + require("./package.json").version
          : ""
      }/tabulator.min.js`,
    },
    {
      script: `/plugins/public/tabulator${
        features?.version_plugin_serve_path
          ? "@" + require("./package.json").version
          : ""
      }/custom.js`,
    },
    {
      script: "/plugins/public/tabulator/luxon.min.js",
    },
    {
      script: "/flatpickr.min.js",
    },
    {
      css: `/flatpickr.min.css`,
    },
    {
      script: "/gridedit.js",
    },
    {
      css: `/plugins/public/tabulator${
        features?.version_plugin_serve_path
          ? "@" + require("./package.json").version
          : ""
      }/tabulator_${stylesheet}.min.css`,
    },
  ],
  sc_plugin_api_version: 1,
  plugin_name: "tabulator",
  configuration_workflow,
  viewtemplates: () => [
    {
      name: "Tabulator",
      display_state_form: false,
      get_state_fields,
      configuration_workflow: view_configuration_workflow,
      run,
      routes: {
        run_action,
        run_selected_rows_action,
        add_preset,
        delete_preset,
      },
    },
  ],
};

const fragment = (...args) => args.filter((s) => s).join("");
