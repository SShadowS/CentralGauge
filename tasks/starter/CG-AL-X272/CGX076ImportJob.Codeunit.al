codeunit 70412 "CG X076 Import Job"
{
    procedure ImportBatch(EntryCodes: List of [Code[20]]; AmountTexts: List of [Text]) ImportedCount: Integer
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        i: Integer;
    begin
        for i := 1 to EntryCodes.Count do
            if Importer.ImportLine(EntryCodes.Get(i), AmountTexts.Get(i)) then
                ImportedCount += 1;
    end;
}
