codeunit 71360 "CG X047 Tagger"
{
    Access = Internal;

    procedure Tag(EntryNo: Integer; DimCode: Code[20]; DimValueCode: Code[20])
    var
        CGX047Ledger: Record "CG X047 Ledger";
        DimensionValue: Record "Dimension Value";
        TempDimensionSetEntry: Record "Dimension Set Entry" temporary;
        CGX047Registrar: Codeunit "CG X047 Registrar";
        DimensionManagement: Codeunit DimensionManagement;
    begin
        CGX047Registrar.Register(EntryNo);

        CGX047Ledger.Get(EntryNo);
        DimensionValue.Get(DimCode, DimValueCode);

        DimensionManagement.GetDimensionSet(TempDimensionSetEntry, CGX047Ledger."Dimension Set ID");

        if TempDimensionSetEntry.Get(CGX047Ledger."Dimension Set ID", DimCode) then begin
            TempDimensionSetEntry."Dimension Value Code" := DimValueCode;
            TempDimensionSetEntry."Dimension Value ID" := DimensionValue."Dimension Value ID";
            TempDimensionSetEntry.Modify();
        end else begin
            TempDimensionSetEntry.Init();
            TempDimensionSetEntry."Dimension Set ID" := CGX047Ledger."Dimension Set ID";
            TempDimensionSetEntry."Dimension Code" := DimCode;
            TempDimensionSetEntry."Dimension Value Code" := DimValueCode;
            TempDimensionSetEntry."Dimension Value ID" := DimensionValue."Dimension Value ID";
            TempDimensionSetEntry.Insert();
        end;

        CGX047Ledger."Dimension Set ID" := DimensionManagement.GetDimensionSetID(TempDimensionSetEntry);
        CGX047Ledger.Modify();
    end;
}