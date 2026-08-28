using Microsoft.Finance.Dimension;

codeunit 80018 "CG-AL-H017 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // The demo company already carries DEPARTMENT and PROJECT dimension values,
    // and the query's DataItemTableFilter cannot be narrowed from outside. So
    // every row seeded here uses the CGH017 code prefix and the assertions
    // filter the exported Code columns down to it.

    var
        Assert: Codeunit Assert;
        CodeFilterTok: Label 'CGH017-*', Locked = true;
        DepartmentTok: Label 'DEPARTMENT', Locked = true;
        ProjectTok: Label 'PROJECT', Locked = true;

    local procedure Reset()
    var
        DimensionValue: Record "Dimension Value";
        DimensionSetEntry: Record "Dimension Set Entry";
    begin
        DimensionValue.SetFilter("Code", CodeFilterTok);
        DimensionValue.DeleteAll(false);
        DimensionSetEntry.SetFilter("Dimension Value Code", CodeFilterTok);
        DimensionSetEntry.DeleteAll(false);
    end;

    local procedure SeedValue(DimensionCode: Code[20]; ValueCode: Code[20]; ValueName: Text[50])
    var
        DimensionValue: Record "Dimension Value";
    begin
        DimensionValue.Init();
        DimensionValue."Dimension Code" := DimensionCode;
        DimensionValue."Code" := ValueCode;
        DimensionValue.Name := ValueName;
        DimensionValue.Insert(false);
    end;

    local procedure SeedSetEntry(SetId: Integer; ValueCode: Code[20])
    var
        DimensionSetEntry: Record "Dimension Set Entry";
    begin
        DimensionSetEntry.Init();
        DimensionSetEntry."Dimension Set ID" := SetId;
        DimensionSetEntry."Dimension Code" := ProjectTok;
        DimensionSetEntry."Dimension Value Code" := ValueCode;
        DimensionSetEntry.Insert(false);
    end;

    local procedure SeedTwoByThree()
    begin
        Reset();
        SeedValue(DepartmentTok, 'CGH017-D1', 'Dept One');
        SeedValue(DepartmentTok, 'CGH017-D2', 'Dept Two');
        SeedValue(ProjectTok, 'CGH017-P1', 'Proj One');
        SeedValue(ProjectTok, 'CGH017-P2', 'Proj Two');
        SeedValue(ProjectTok, 'CGH017-P3', 'Proj Three');
    end;

    [Test]
    procedure EveryDepartmentIsPairedWithEveryProject()
    var
        DimMatrix: Query "CG Dimension Matrix";
        Pairs: List of [Text];
        Pair: Text;
    begin
        // [SCENARIO] Two departments and three projects cross-join to six rows
        SeedTwoByThree();

        DimMatrix.SetFilter(DepartmentCode, CodeFilterTok);
        DimMatrix.SetFilter(ProjectCode, CodeFilterTok);
        DimMatrix.Open();
        while DimMatrix.Read() do begin
            Pair := DimMatrix.DepartmentCode + '|' + DimMatrix.ProjectCode;
            Assert.IsFalse(Pairs.Contains(Pair), StrSubstNo('Expected each department/project pair exactly once, but %1 repeated', Pair));
            Pairs.Add(Pair);
        end;
        DimMatrix.Close();

        Assert.AreEqual(6, Pairs.Count(), 'Expected a cross join of 2 departments and 3 projects to produce 6 rows');
        Assert.IsTrue(Pairs.Contains('CGH017-D1|CGH017-P1'), 'Expected the first department paired with the first project');
        Assert.IsTrue(Pairs.Contains('CGH017-D1|CGH017-P3'), 'Expected the first department paired with the last project');
        Assert.IsTrue(Pairs.Contains('CGH017-D2|CGH017-P1'), 'Expected the second department paired with the first project');
        Assert.IsTrue(Pairs.Contains('CGH017-D2|CGH017-P3'), 'Expected the second department paired with the last project');
    end;

    [Test]
    procedure AddingOneDepartmentMultipliesTheRowCount()
    var
        DimMatrix: Query "CG Dimension Matrix";
        Rows: Integer;
    begin
        // [SCENARIO] A third department takes 2x3 to 3x3 - the signature of a
        // Cartesian product rather than a join on a shared key
        SeedTwoByThree();
        SeedValue(DepartmentTok, 'CGH017-D3', 'Dept Three');

        DimMatrix.SetFilter(DepartmentCode, CodeFilterTok);
        DimMatrix.SetFilter(ProjectCode, CodeFilterTok);
        DimMatrix.Open();
        while DimMatrix.Read() do
            Rows += 1;
        DimMatrix.Close();

        Assert.AreEqual(9, Rows, 'Expected 3 departments crossed with 3 projects to produce 9 rows');
    end;

    [Test]
    procedure NameColumnsComeFromTheirOwnDataItem()
    var
        DimMatrix: Query "CG Dimension Matrix";
        Rows: Integer;
    begin
        // [SCENARIO] Both name columns read Name off "Dimension Value"; a
        // solution that points them at the same dataitem still compiles
        SeedTwoByThree();

        DimMatrix.SetFilter(DepartmentCode, 'CGH017-D1');
        DimMatrix.SetFilter(ProjectCode, 'CGH017-P2');
        DimMatrix.Open();
        while DimMatrix.Read() do begin
            Rows += 1;
            Assert.AreEqual('Dept One', DimMatrix.DepartmentName, 'Expected DepartmentName to carry the department dataitem''s Name');
            Assert.AreEqual('Proj Two', DimMatrix.ProjectName, 'Expected ProjectName to carry the project dataitem''s Name');
        end;
        DimMatrix.Close();

        Assert.AreEqual(1, Rows, 'Expected exactly one row for one department crossed with one project');
    end;

    [Test]
    procedure ProjectsWithoutDimensionSetEntriesStillAppear()
    var
        DimMatrix: Query "CG Dimension Matrix";
        Rows: Integer;
    begin
        // [SCENARIO] The Dimension Set Entry join is a LEFT outer join, so a
        // project no entry references must not drop out of the matrix
        SeedTwoByThree();
        SeedSetEntry(9170001, 'CGH017-P1');

        DimMatrix.SetFilter(DepartmentCode, CodeFilterTok);
        DimMatrix.SetFilter(ProjectCode, 'CGH017-P3');
        DimMatrix.Open();
        while DimMatrix.Read() do
            Rows += 1;
        DimMatrix.Close();

        Assert.AreEqual(2, Rows, 'Expected a project with no dimension set entries to survive the left outer join, once per department');
    end;

    [Test]
    procedure MatchCountRisesWithTheNumberOfDimensionSetEntries()
    var
        DimMatrix: Query "CG Dimension Matrix";
        MatchedCount: Integer;
        UnmatchedCount: Integer;
    begin
        // [SCENARIO] MatchCount counts the joined Dimension Set Entry rows
        SeedTwoByThree();
        SeedSetEntry(9170001, 'CGH017-P1');
        SeedSetEntry(9170002, 'CGH017-P1');
        SeedSetEntry(9170003, 'CGH017-P1');

        DimMatrix.SetFilter(DepartmentCode, 'CGH017-D1');
        DimMatrix.SetFilter(ProjectCode, 'CGH017-P1');
        DimMatrix.Open();
        Assert.IsTrue(DimMatrix.Read(), 'Expected a row for the department crossed with the referenced project');
        MatchedCount := DimMatrix.MatchCount;
        DimMatrix.Close();

        DimMatrix.SetFilter(DepartmentCode, 'CGH017-D1');
        DimMatrix.SetFilter(ProjectCode, 'CGH017-P2');
        DimMatrix.Open();
        Assert.IsTrue(DimMatrix.Read(), 'Expected a row for the department crossed with the unreferenced project');
        UnmatchedCount := DimMatrix.MatchCount;
        DimMatrix.Close();

        Assert.AreEqual(3, MatchedCount, 'Expected MatchCount to count the three dimension set entries referencing the project');
        Assert.IsTrue(MatchedCount > UnmatchedCount, StrSubstNo('Expected a project with entries to outcount one without, but got %1 against %2', MatchedCount, UnmatchedCount));
    end;
}
