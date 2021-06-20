import JsConfuser from "../../../src/index";

it("should split strings", async () => {
  var code = `var TEST_STRING = "the brown dog jumped over the lazy fox."`;

  var output = await JsConfuser(code, {
    target: "browser",
    stringSplitting: true,
  });

  expect(output).not.toContain("the brown dog jumped over the lazy fox.");
});

it("should split strings and concatenate correctly", async () => {
  var code = `input("the brown dog jumped over the lazy fox.")`;

  var output = await JsConfuser(code, {
    target: "browser",
    stringSplitting: true,
  });

  var value = "never_called";
  function input(valueIn) {
    value = valueIn;
  }

  expect(output).not.toContain("the brown dog jumped over the lazy fox.");

  eval(output);

  expect(value).toStrictEqual("the brown dog jumped over the lazy fox.");
});

it("should work on property keys", async () => {
  var code = `
  var myObject = {
    myVeryLongStringThatShouldGetSplit: 100
  }

  TEST_VAR = myObject.myVeryLongStringThatShouldGetSplit;
  `;

  var output = await JsConfuser(code, {
    target: "node",
    stringSplitting: true,
  });

  expect(output).not.toContain("myVeryLongStringThatShouldGetSplit");

  var TEST_VAR;
  eval(output);

  expect(TEST_VAR).toStrictEqual(100);
});

it("should work on class keys", async () => {
  var code = `
  class MyClass {
    myVeryLongMethodName(){
      return 100;
    }
  }

  var myObject = new MyClass();

  TEST_VAR = myObject.myVeryLongMethodName();
  `;

  var output = await JsConfuser(code, {
    target: "node",
    stringSplitting: true,
  });

  expect(output).not.toContain("myVeryLongMethodName");

  var TEST_VAR;
  eval(output);

  expect(TEST_VAR).toStrictEqual(100);
});

it("should not encode constructor key", async () => {
  var code = `
  class MyClass {
    constructor(){
      TEST_VAR = 100;
    }
  }

  new MyClass();
  `;

  var output = await JsConfuser(code, {
    target: "node",
    stringSplitting: true,
  });

  var TEST_VAR;
  eval(output);

  expect(TEST_VAR).toStrictEqual(100);
});
