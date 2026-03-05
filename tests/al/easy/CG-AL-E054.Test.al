codeunit 80054 "CG-AL-E054 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        GuidGen: Codeunit "CG Sequential Guid Generator";

    [Test]
    procedure TestGenerateSequentialGuid_NotEmpty()
    var
        Result: Guid;
        EmptyGuid: Guid;
    begin
        // [SCENARIO] GenerateSequentialGuid returns a non-empty GUID
        // [WHEN] Generating a sequential GUID
        Result := GuidGen.GenerateSequentialGuid();

        // [THEN] Result is not empty
        Assert.AreNotEqual(EmptyGuid, Result, 'Sequential GUID should not be empty');
    end;

    [Test]
    procedure TestGenerateSequentialGuid_Unique()
    var
        Guid1: Guid;
        Guid2: Guid;
    begin
        // [SCENARIO] Each call returns a unique GUID
        // [WHEN] Generating two sequential GUIDs
        Guid1 := GuidGen.GenerateSequentialGuid();
        Guid2 := GuidGen.GenerateSequentialGuid();

        // [THEN] They are different
        Assert.AreNotEqual(Guid1, Guid2, 'Sequential GUIDs should be unique');
    end;

    [Test]
    procedure TestGenerateMultipleGuids_CorrectCount()
    var
        Guids: List of [Guid];
    begin
        // [SCENARIO] GenerateMultipleGuids returns the requested count
        // [WHEN] Generating 5 GUIDs
        Guids := GuidGen.GenerateMultipleGuids(5);

        // [THEN] List has 5 entries
        Assert.AreEqual(5, Guids.Count, 'Should generate exactly 5 GUIDs');
    end;

    [Test]
    procedure TestGenerateMultipleGuids_AllUnique()
    var
        Guids: List of [Guid];
        i: Integer;
        j: Integer;
        Guid1: Guid;
        Guid2: Guid;
    begin
        // [SCENARIO] All generated GUIDs are unique
        // [WHEN] Generating 3 GUIDs
        Guids := GuidGen.GenerateMultipleGuids(3);

        // [THEN] No duplicates
        for i := 1 to Guids.Count do
            for j := i + 1 to Guids.Count do begin
                Guids.Get(i, Guid1);
                Guids.Get(j, Guid2);
                Assert.AreNotEqual(Guid1, Guid2, 'All GUIDs should be unique');
            end;
    end;

    [Test]
    procedure TestGenerateMultipleGuids_ZeroCount()
    var
        Guids: List of [Guid];
    begin
        // [SCENARIO] GenerateMultipleGuids with zero returns empty list
        // [WHEN] Generating 0 GUIDs
        Guids := GuidGen.GenerateMultipleGuids(0);

        // [THEN] List is empty
        Assert.AreEqual(0, Guids.Count, 'Should return empty list for zero count');
    end;

    [Test]
    procedure TestIsSequentialGuid_ValidGuid()
    var
        ValidGuid: Guid;
        Result: Boolean;
    begin
        // [SCENARIO] IsSequentialGuid returns true for non-empty GUID
        // [GIVEN] A non-empty GUID
        ValidGuid := GuidGen.GenerateSequentialGuid();

        // [WHEN] Checking if sequential
        Result := GuidGen.IsSequentialGuid(ValidGuid);

        // [THEN] Returns true
        Assert.IsTrue(Result, 'Non-empty GUID should return true');
    end;

    [Test]
    procedure TestIsSequentialGuid_EmptyGuid()
    var
        EmptyGuid: Guid;
        Result: Boolean;
    begin
        // [SCENARIO] IsSequentialGuid returns false for empty GUID
        // [WHEN] Checking empty GUID
        Result := GuidGen.IsSequentialGuid(EmptyGuid);

        // [THEN] Returns false
        Assert.IsFalse(Result, 'Empty GUID should return false');
    end;

    [Test]
    procedure TestCompareGuids_Different()
    var
        Guid1: Guid;
        Guid2: Guid;
        Result: Boolean;
    begin
        // [SCENARIO] CompareGuids returns true for different GUIDs
        // [GIVEN] Two different GUIDs
        Guid1 := GuidGen.GenerateSequentialGuid();
        Guid2 := GuidGen.GenerateSequentialGuid();

        // [WHEN] Comparing
        Result := GuidGen.CompareGuids(Guid1, Guid2);

        // [THEN] Returns true (they differ)
        Assert.IsTrue(Result, 'Different GUIDs should return true');
    end;

    [Test]
    procedure TestCompareGuids_Same()
    var
        Guid1: Guid;
        Result: Boolean;
    begin
        // [SCENARIO] CompareGuids returns false for identical GUIDs
        // [GIVEN] Same GUID
        Guid1 := GuidGen.GenerateSequentialGuid();

        // [WHEN] Comparing with itself
        Result := GuidGen.CompareGuids(Guid1, Guid1);

        // [THEN] Returns false (they are equal)
        Assert.IsFalse(Result, 'Same GUID should return false');
    end;
}
