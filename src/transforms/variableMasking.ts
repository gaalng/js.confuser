import { PluginObj } from "@babel/core";
import { NodePath } from "@babel/traverse";
import { PluginArg } from "./plugin";
import * as t from "@babel/types";
import Template from "../templates/template";
import { computeProbabilityMap } from "../probability";
import { Order } from "../order";
import { NodeSymbol, UNSAFE } from "../constants";
import { getFunctionName } from "../utils/ast-utils";
import {
  computeFunctionLength,
  isFunctionStrictMode,
} from "../utils/function-utils";

export default ({ Plugin }: PluginArg): PluginObj => {
  const me = Plugin(Order.VariableMasking);

  const transformFunction = (fnPath: NodePath<t.Function>) => {
    // Do not apply to getter/setter methods
    if (fnPath.isObjectMethod() && fnPath.node.kind !== "method") {
      return;
    }

    // Do not apply to class getters/setters
    if (fnPath.isClassMethod() && fnPath.node.kind !== "method") {
      return;
    }

    // Do not apply to async or generator functions
    if (fnPath.node.generator || fnPath.node.async) {
      return;
    }

    // Do not apply to functions with rest parameters or destructuring
    if (fnPath.node.params.some((param) => !t.isIdentifier(param))) {
      return;
    }

    // Do not apply to 'use strict' functions
    if (isFunctionStrictMode(fnPath)) return;

    // Do not apply to functions marked unsafe
    if ((fnPath.node as NodeSymbol)[UNSAFE]) return;

    const functionName = getFunctionName(fnPath);

    if (!computeProbabilityMap(me.options.variableMasking, functionName)) {
      return;
    }

    const stackName = me.generateRandomIdentifier() + "_varMask";
    const stackMap = new Map<string, number>();
    let needsStack = false;

    for (const param of fnPath.node.params) {
      stackMap.set((param as t.Identifier).name, stackMap.size);
    }

    fnPath.traverse({
      BindingIdentifier(identifierPath) {
        const binding = identifierPath.scope.getBinding(
          identifierPath.node.name
        );
        if (!binding || binding.scope !== fnPath.scope) return;

        if (binding.path.isIdentifier()) {
          // Parameter check
          if (
            !fnPath.node.params.some(
              (param) =>
                t.isIdentifier(param) &&
                param.name === (binding.path.node as t.Identifier).name
            )
          ) {
            return;
          }
        } else if (binding.path.isVariableDeclarator()) {
          if (binding.path.parentPath.node?.type !== "VariableDeclaration")
            return;
          if (binding.path.parentPath.node.declarations.length > 1) return;
          if (!t.isIdentifier(binding.path.parentPath.node.declarations[0].id))
            return;
        } else {
          return;
        }

        needsStack = true;

        let stackIndex = stackMap.get(identifierPath.node.name);
        if (typeof stackIndex === "undefined") {
          stackIndex = stackMap.size;
          stackMap.set(identifierPath.node.name, stackIndex);
        }

        const memberExpression = new Template(`
          ${stackName}[${stackIndex}]
          `).expression<t.MemberExpression>();

        binding.referencePaths.forEach((referencePath) => {
          var callExpressionChild = referencePath;

          if (
            callExpressionChild &&
            callExpressionChild.parentPath?.isCallExpression() &&
            callExpressionChild.parentPath.node.callee ===
              callExpressionChild.node
          ) {
            callExpressionChild.parentPath.replaceWith(
              t.callExpression(
                t.memberExpression(
                  t.cloneNode(memberExpression),
                  t.identifier("call")
                ),
                [
                  t.thisExpression(),
                  ...callExpressionChild.parentPath.node.arguments,
                ]
              )
            );

            return;
          }

          if (referencePath.container) {
            referencePath.replaceWith(t.cloneNode(memberExpression));
          }
        });

        [binding.path, ...binding.constantViolations].forEach(
          (constantViolation) => {
            constantViolation.traverse({
              "ReferencedIdentifier|BindingIdentifier"(idPath) {
                if (!idPath.isIdentifier()) return;

                const cBinding = idPath.scope.getBinding(idPath.node.name);
                if (cBinding !== binding) return;

                var replacePath: NodePath = idPath;
                var valueNode: t.Expression | null = null;

                var forInOfChild = idPath.find(
                  (p) =>
                    p.parentPath?.isForInStatement() ||
                    p.parentPath?.isForOfStatement()
                );

                var variableDeclarationChild = idPath.find((p) =>
                  p.parentPath?.isVariableDeclarator()
                );

                if (
                  variableDeclarationChild &&
                  t.isVariableDeclarator(variableDeclarationChild.parent) &&
                  variableDeclarationChild.parent.id ===
                    variableDeclarationChild.node
                ) {
                  replacePath = variableDeclarationChild.parentPath.parentPath;
                  valueNode =
                    variableDeclarationChild.parent.init ||
                    t.identifier("undefined");
                }

                if (
                  forInOfChild &&
                  (t.isForInStatement(forInOfChild.parent) ||
                    t.isForOfStatement(forInOfChild.parent)) &&
                  forInOfChild.parent.left === forInOfChild.node
                ) {
                  replacePath = forInOfChild;
                  valueNode = null;
                }

                let replaceExpr: t.Node = t.cloneNode(memberExpression);
                if (valueNode) {
                  replaceExpr = t.assignmentExpression(
                    "=",
                    replaceExpr,
                    valueNode
                  );
                }

                if (replacePath.container) {
                  replacePath.replaceWith(replaceExpr);
                }
              },
            });
          }
        );

        identifierPath.scope.removeBinding(identifierPath.node.name);
      },
    });

    if (!needsStack) return;

    var originalLength = computeFunctionLength(fnPath);
    fnPath.node.params = [t.restElement(t.identifier(stackName))];

    fnPath.scope.registerBinding("param", fnPath.get("params")[0], fnPath);

    me.setFunctionLength(fnPath, originalLength);
  };

  return {
    visitor: {
      Function: {
        exit(path: NodePath<t.Function>) {
          transformFunction(path);
        },
      },
    },
  };
};
