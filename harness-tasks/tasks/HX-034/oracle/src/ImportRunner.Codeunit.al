codeunit 86141 "HX034 Import Runner"
{
    var
        Payload: Text;
        Imported: Integer;

    procedure SetPayload(NewPayload: Text)
    begin
        Payload := NewPayload;
        Imported := -1;
    end;

    procedure ImportedCount(): Integer
    begin
        exit(Imported);
    end;

    trigger OnRun()
    var
        ReturnImport: Codeunit "CGR Return Import";
    begin
        Imported := ReturnImport.ImportReturns(Payload);
    end;
}
