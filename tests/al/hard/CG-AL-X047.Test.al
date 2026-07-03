codeunit 80336 "CG-AL-X047 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Ledger: Record "CG X047 Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure EnsureDimension(DimCode: Code[20])
    var
        Dimension: Record Dimension;
    begin
        if not Dimension.Get(DimCode) then begin
            Dimension.Init();
            Dimension.Validate(Code, DimCode);
            Dimension.Insert(true);
        end;
    end;

    local procedure EnsureDimensionValue(DimCode: Code[20]; DimValueCode: Code[20])
    var
        DimensionValue: Record "Dimension Value";
    begin
        EnsureDimension(DimCode);
        if not DimensionValue.Get(DimCode, DimValueCode) then begin
            DimensionValue.Init();
            DimensionValue.Validate("Dimension Code", DimCode);
            DimensionValue.Validate(Code, DimValueCode);
            DimensionValue.Insert(true);
        end;
    end;

    // Builds a brand-new dimension set containing exactly one dimension,
    // the way two independent ledger rows would come to legitimately
    // SHARE a Dimension Set ID in real data.
    local procedure BuildSet(DimCode: Code[20]; DimValueCode: Code[20]): Integer
    var
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        EnsureDimensionValue(DimCode, DimValueCode);
        TempDimSetEntry.Init();
        TempDimSetEntry.Validate("Dimension Code", DimCode);
        TempDimSetEntry.Validate("Dimension Value Code", DimValueCode);
        TempDimSetEntry.Insert();
        exit(DimMgt.GetDimensionSetID(TempDimSetEntry));
    end;

    local procedure AssertSetIsExactlyOne(SetId: Integer; DimCode: Code[20]; DimValueCode: Code[20]; ErrCtx: Text)
    var
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        DimMgt.GetDimensionSet(TempDimSetEntry, SetId);
        Assert.AreEqual(1, TempDimSetEntry.Count(), ErrCtx + ': expected exactly one dimension in the set');
        TempDimSetEntry.FindFirst();
        Assert.AreEqual(DimCode, TempDimSetEntry."Dimension Code", ErrCtx + ': dimension code mismatch');
        Assert.AreEqual(DimValueCode, TempDimSetEntry."Dimension Value Code", ErrCtx + ': dimension value mismatch');
    end;

    local procedure AssertSetIsExactlyThree(SetId: Integer; DimCode1: Code[20]; DimValueCode1: Code[20]; DimCode2: Code[20]; DimValueCode2: Code[20]; DimCode3: Code[20]; DimValueCode3: Code[20]; ErrCtx: Text)
    var
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        DimMgt.GetDimensionSet(TempDimSetEntry, SetId);
        Assert.AreEqual(3, TempDimSetEntry.Count(), ErrCtx + ': expected exactly three dimensions in the set');

        Assert.IsTrue(TempDimSetEntry.Get(SetId, DimCode1), ErrCtx + ': missing dimension ' + DimCode1);
        Assert.AreEqual(DimValueCode1, TempDimSetEntry."Dimension Value Code", ErrCtx + ': wrong value for ' + DimCode1);

        Assert.IsTrue(TempDimSetEntry.Get(SetId, DimCode2), ErrCtx + ': missing dimension ' + DimCode2);
        Assert.AreEqual(DimValueCode2, TempDimSetEntry."Dimension Value Code", ErrCtx + ': wrong value for ' + DimCode2);

        Assert.IsTrue(TempDimSetEntry.Get(SetId, DimCode3), ErrCtx + ': missing dimension ' + DimCode3);
        Assert.AreEqual(DimValueCode3, TempDimSetEntry."Dimension Value Code", ErrCtx + ': wrong value for ' + DimCode3);
    end;

    [Test]
    procedure TagPreservesExistingDimAndProtectsDecoy()
    var
        Ledger: Record "CG X047 Ledger";
        Tagger: Codeunit "CG X047 Tagger";
        SharedSetId: Integer;
    begin
        // [GIVEN] Two ledger entries that legitimately share one dimension
        // set (CGDEPT=SALES), the way two documents posted under the same
        // dimension configuration would.
        Reset();
        SharedSetId := BuildSet('CGDEPT', 'SALES');

        Ledger.Init();
        Ledger."Entry No." := 1;
        Ledger."Dimension Set ID" := SharedSetId;
        Ledger.Insert();

        Ledger.Init();
        Ledger."Entry No." := 2;
        Ledger."Dimension Set ID" := SharedSetId;
        Ledger.Insert();

        // [WHEN] Tag adds a new dimension to entry 1 only
        EnsureDimensionValue('CGPROJ', 'ALPHA');
        Tagger.Tag(1, 'CGPROJ', 'ALPHA');

        // [THEN] Entry 1 carries the dimension it already had, the
        // Registrar's own (undisclosed) addition, AND the new dimension.
        Ledger.Get(1);
        AssertSetIsExactlyThree(
            Ledger."Dimension Set ID",
            'CGDEPT', 'SALES',
            'CGAUDIT', 'STAMPED',
            'CGPROJ', 'ALPHA',
            'Entry 1 (target)');

        // [THEN] Entry 2 never asked to be tagged and shared the ORIGINAL
        // set: it must be completely unaffected, both its own Dimension
        // Set ID field and that set's actual contents.
        Ledger.Get(2);
        Assert.AreEqual(SharedSetId, Ledger."Dimension Set ID", 'Decoy entry 2 Dimension Set ID must be unchanged');
        AssertSetIsExactlyOne(Ledger."Dimension Set ID", 'CGDEPT', 'SALES', 'Entry 2 (decoy)');
    end;

    [Test]
    procedure TagSecondScenarioBlocksHardcoding()
    var
        Ledger: Record "CG X047 Ledger";
        Tagger: Codeunit "CG X047 Tagger";
        SharedSetId: Integer;
    begin
        // [GIVEN] A different pair of dimension/value codes and a
        // different pair of ledger entries, so a hardcoded response to
        // the first scenario cannot pass this one too.
        Reset();
        SharedSetId := BuildSet('CGREGION', 'NORTH');

        Ledger.Init();
        Ledger."Entry No." := 3;
        Ledger."Dimension Set ID" := SharedSetId;
        Ledger.Insert();

        Ledger.Init();
        Ledger."Entry No." := 4;
        Ledger."Dimension Set ID" := SharedSetId;
        Ledger.Insert();

        // [WHEN] Tag adds a new dimension to entry 3 only
        EnsureDimensionValue('CGTEAM', 'BETA');
        Tagger.Tag(3, 'CGTEAM', 'BETA');

        // [THEN] Entry 3 carries the original dimension, the Registrar's
        // addition, and the new dimension.
        Ledger.Get(3);
        AssertSetIsExactlyThree(
            Ledger."Dimension Set ID",
            'CGREGION', 'NORTH',
            'CGAUDIT', 'STAMPED',
            'CGTEAM', 'BETA',
            'Entry 3 (target)');

        // [THEN] Entry 4 (decoy) is completely unaffected.
        Ledger.Get(4);
        Assert.AreEqual(SharedSetId, Ledger."Dimension Set ID", 'Decoy entry 4 Dimension Set ID must be unchanged');
        AssertSetIsExactlyOne(Ledger."Dimension Set ID", 'CGREGION', 'NORTH', 'Entry 4 (decoy)');
    end;
}
