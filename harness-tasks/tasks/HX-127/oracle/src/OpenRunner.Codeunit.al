codeunit 87867 "HX127 Open Runner"
{
    var
        RunnerSelectionCode: Code[20];

    procedure SetHX127Code(SelectionCode: Code[20])
    begin
        RunnerSelectionCode := SelectionCode;
    end;

    trigger OnRun()
    var
        Store: Codeunit "CGR Desk Selection Store";
        Opened: RecordRef;
    begin
        Store.OpenSelection(RunnerSelectionCode, Opened);
    end;
}
