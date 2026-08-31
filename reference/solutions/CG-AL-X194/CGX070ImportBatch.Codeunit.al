codeunit 70353 "CG X070 Import Batch"
{
    var
        QuantityMustBePositiveErr: Label 'Quantity must be positive in line %1 of batch %2.', Comment = '%1 = line no., %2 = batch code';

    procedure ImportBatch(BatchCode: Code[20])
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        ImportLine.SetRange("Batch Code", BatchCode);
        ImportLine.SetRange(Status, "CG X070 Import Status"::Pending);
        if not ImportLine.FindSet(true) then
            exit;

        repeat
            ImportLine.TestField("Customer No.");
            if ImportLine.Quantity <= 0 then
                Error(QuantityMustBePositiveErr, ImportLine."Line No.", BatchCode);

            InsertImportedOrder(ImportLine);
            ImportLine.Status := "CG X070 Import Status"::Imported;
            ImportLine.Modify();
            Commit();
        until ImportLine.Next() = 0;
    end;

    local procedure InsertImportedOrder(ImportLine: Record "CG X070 Import Line")
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportedOrder.Init();
        ImportedOrder."Batch Code" := ImportLine."Batch Code";
        ImportedOrder."Line No." := ImportLine."Line No.";
        ImportedOrder."Customer No." := ImportLine."Customer No.";
        ImportedOrder.Quantity := ImportLine.Quantity;
        ImportedOrder.Insert();
    end;
}
