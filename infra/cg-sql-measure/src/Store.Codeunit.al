namespace CentralGauge.SqlMeasure;

using System.TestTools.TestRunner;

/// <summary>
/// Q-06: counts SQL statements per [Test] method. SingleInstance, so the entries
/// live for the whole session; nothing is written to the database (a test
/// isolation rollback cannot erase an entry, and the counting cannot change what
/// a test sees).
/// The numbers include a constant framework overhead per method (the same for
/// every solution), so compare solutions, never read them as absolute cost.
/// </summary>
codeunit 50560 "CG SQL Measure Store"
{
    SingleInstance = true;

    var
        Entries: JsonArray;
        MethodStatements: Integer;
        MethodStart: DateTime;
        Active: Boolean;

    /// <summary>
    /// Turn recording on or off. Only the measuring runner sets it, around its
    /// one harness run; while it is off the subscribers record nothing, so an
    /// ordinary run never feeds the store.
    /// </summary>
    procedure SetActive(Value: Boolean)
    begin
        Active := Value;
    end;

    /// <summary>Forget every entry (called before a measured run).</summary>
    procedure ClearEntries()
    var
        Empty: JsonArray;
    begin
        Entries := Empty;
    end;

    /// <summary>The entries as a JSON array text.</summary>
    procedure GetJson() Json: Text
    begin
        Entries.WriteTo(Json);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Test Runner - Mgt", 'OnBeforeTestMethodRun', '', false, false)]
    local procedure OnBeforeTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; var Skip: Boolean)
    begin
        if not Active then
            exit;
        MethodStatements := SessionInformation.SqlStatementsExecuted;
        MethodStart := CurrentDateTime();
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Test Runner - Mgt", 'OnAfterTestMethodRun', '', false, false)]
    local procedure OnAfterTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; IsSuccess: Boolean)
    var
        Entry: JsonObject;
    begin
        if not Active then
            exit;
        Entry.Add('codeunitId', CodeunitID);
        Entry.Add('functionName', FunctionName);
        Entry.Add('statements', SessionInformation.SqlStatementsExecuted - MethodStatements);
        Entry.Add('ms', CurrentDateTime() - MethodStart);
        Entry.Add('isSuccess', IsSuccess);
        Entries.Add(Entry);
    end;
}
