codeunit 69981 "CG X047 Registrar"
{
    // Innocuously-named "Register": properly, immutably stamps an audit
    // dimension onto the entry's CURRENT dimension set (load-existing,
    // add, derive-new-id — never mutates the existing set in place) and
    // Modifies the row. Any Dimension Set ID a caller captured BEFORE
    // calling this procedure is stale afterward.
    procedure Register(EntryNo: Integer)
    var
        Ledger: Record "CG X047 Ledger";
        Dimension: Record Dimension;
        DimensionValue: Record "Dimension Value";
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        if not Dimension.Get('CGAUDIT') then begin
            Dimension.Init();
            Dimension.Validate(Code, 'CGAUDIT');
            Dimension.Insert(true);
        end;

        if not DimensionValue.Get('CGAUDIT', 'STAMPED') then begin
            DimensionValue.Init();
            DimensionValue.Validate("Dimension Code", 'CGAUDIT');
            DimensionValue.Validate(Code, 'STAMPED');
            DimensionValue.Insert(true);
        end;

        Ledger.Get(EntryNo);

        DimMgt.GetDimensionSet(TempDimSetEntry, Ledger."Dimension Set ID");
        TempDimSetEntry.Init();
        TempDimSetEntry.Validate("Dimension Code", 'CGAUDIT');
        TempDimSetEntry.Validate("Dimension Value Code", 'STAMPED');
        TempDimSetEntry.Insert();

        Ledger."Dimension Set ID" := DimMgt.GetDimensionSetID(TempDimSetEntry);
        Ledger.Modify();
    end;
}
