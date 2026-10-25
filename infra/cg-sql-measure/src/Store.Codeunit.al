using System.TestTools.TestRunner;

/// <summary>
/// Q-06: counts SQL statements per [Test] method. SingleInstance, so the entries
/// live for the whole session; nothing is written to the database (a test
/// isolation rollback cannot erase an entry, and the counting cannot change what
/// a test sees). Public on purpose: a scale scenario in another app calls
/// BeginSegment / EndSegment around one call to measure just that call.
/// The numbers include a constant framework overhead per method (the same for
/// every solution), so compare solutions, never read them as absolute cost.
/// </summary>
codeunit 50560 "CG SQL Measure Store"
{
    SingleInstance = true;

    var
        Entries: JsonArray;
        CurrentCodeunitId: Integer;
        CurrentFunction: Text[128];
        MethodStatements: Integer;
        MethodStart: DateTime;
        SegmentOpen: Boolean;
        SegmentName: Text[50];
        SegmentStatements: Integer;
        SegmentStart: DateTime;

    /// <summary>Forget every entry (called before a measured run).</summary>
    procedure ClearEntries()
    var
        Empty: JsonArray;
    begin
        Entries := Empty;
        SegmentOpen := false;
        CurrentCodeunitId := 0;
        CurrentFunction := '';
    end;

    /// <summary>The entries as a JSON array text.</summary>
    procedure GetJson() Json: Text
    begin
        Entries.WriteTo(Json);
    end;

    /// <summary>Start measuring a named part of the current test method.</summary>
    procedure BeginSegment(Name: Text[50])
    begin
        if SegmentOpen then
            Error('CG SQL Measure: segment %1 is still open; call EndSegment first.', SegmentName);
        SegmentName := Name;
        SegmentStatements := SessionInformation.SqlStatementsExecuted;
        SegmentStart := CurrentDateTime();
        SegmentOpen := true;
    end;

    /// <summary>
    /// Record the open segment against the current test method. An Error without
    /// a BeginSegment, so a broken scenario fails loudly.
    /// </summary>
    procedure EndSegment()
    begin
        if not SegmentOpen then
            Error('CG SQL Measure: EndSegment without BeginSegment.');
        Append(
            SegmentName,
            SessionInformation.SqlStatementsExecuted - SegmentStatements,
            CurrentDateTime() - SegmentStart,
            true);
        SegmentOpen := false;
    end;

    local procedure Append(Segment: Text; Statements: Integer; Elapsed: Duration; IsSuccess: Boolean)
    var
        Entry: JsonObject;
    begin
        Entry.Add('codeunitId', CurrentCodeunitId);
        Entry.Add('functionName', CurrentFunction);
        Entry.Add('statements', Statements);
        Entry.Add('ms', Elapsed);
        Entry.Add('isSuccess', IsSuccess);
        // A whole-method entry has no 'segment' key: the reader maps absent to null.
        if Segment <> '' then
            Entry.Add('segment', Segment);
        Entries.Add(Entry);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Test Runner - Mgt", 'OnBeforeTestMethodRun', '', false, false)]
    local procedure OnBeforeTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; var Skip: Boolean)
    begin
        CurrentCodeunitId := CodeunitID;
        CurrentFunction := FunctionName;
        SegmentOpen := false;
        MethodStatements := SessionInformation.SqlStatementsExecuted;
        MethodStart := CurrentDateTime();
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Test Runner - Mgt", 'OnAfterTestMethodRun', '', false, false)]
    local procedure OnAfterTestMethodRun(var CurrentTestMethodLine: Record "Test Method Line"; CodeunitID: Integer; CodeunitName: Text[30]; FunctionName: Text[128]; FunctionTestPermissions: TestPermissions; IsSuccess: Boolean)
    begin
        CurrentCodeunitId := CodeunitID;
        CurrentFunction := FunctionName;
        Append(
            '',
            SessionInformation.SqlStatementsExecuted - MethodStatements,
            CurrentDateTime() - MethodStart,
            IsSuccess);
    end;
}
