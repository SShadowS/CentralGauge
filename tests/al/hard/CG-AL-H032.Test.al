codeunit 80232 "CG-AL-H032 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Walker: Codeunit "CG H032 Relation Walker";

    [Test]
    procedure TestCountRelationFields_SalesHeaderToCustomer()
    var
        Count: Integer;
    begin
        Count := Walker.CountRelationFields(Database::"Sales Header", Database::Customer);
        Assert.IsTrue(Count >= 2,
            'Sales Header has at least 2 Customer-related fields');
    end;

    [Test]
    procedure TestCountRelationFields_NoMatch()
    begin
        Assert.AreEqual(0,
            Walker.CountRelationFields(Database::Customer, 9999999),
            'No fields relate to non-existent table');
    end;

    [Test]
    procedure TestGetNthRelationField_First()
    var
        FieldNo: Integer;
    begin
        FieldNo := Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, 1);
        Assert.IsTrue(FieldNo > 0,
            'First Customer relation field number must be positive');
    end;

    [Test]
    procedure TestGetNthRelationField_Ascending()
    var
        FieldNo1: Integer;
        FieldNo2: Integer;
    begin
        FieldNo1 := Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, 1);
        FieldNo2 := Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, 2);
        Assert.IsTrue(FieldNo2 > FieldNo1,
            'Field numbers should be ascending');
    end;

    [Test]
    procedure TestGetNthRelationField_OutOfRange()
    begin
        Assert.AreEqual(0,
            Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, 9999),
            'N beyond match count returns 0');
    end;

    [Test]
    procedure TestGetNthRelationField_ZeroOrNegative()
    begin
        Assert.AreEqual(0,
            Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, 0),
            'N=0 returns 0');
        Assert.AreEqual(0,
            Walker.GetNthRelationField(Database::"Sales Header", Database::Customer, -1),
            'Negative N returns 0');
    end;

    [Test]
    procedure TestGetAllRelationFieldNumbers_CountMatches()
    var
        FieldNos: List of [Integer];
        Count: Integer;
    begin
        FieldNos := Walker.GetAllRelationFieldNumbers(Database::"Sales Header", Database::Customer);
        Count := Walker.CountRelationFields(Database::"Sales Header", Database::Customer);
        Assert.AreEqual(Count, FieldNos.Count,
            'List length should match count');
    end;

    [Test]
    procedure TestGetAllRelationFieldNumbers_Sorted()
    var
        FieldNos: List of [Integer];
        i: Integer;
    begin
        FieldNos := Walker.GetAllRelationFieldNumbers(Database::"Sales Header", Database::Customer);
        for i := 2 to FieldNos.Count do
            Assert.IsTrue(FieldNos.Get(i) > FieldNos.Get(i - 1),
                'Field numbers should be strictly ascending');
    end;

    [Test]
    procedure TestGetAllRelationFieldNumbers_Empty()
    var
        FieldNos: List of [Integer];
    begin
        FieldNos := Walker.GetAllRelationFieldNumbers(Database::Customer, 9999999);
        Assert.AreEqual(0, FieldNos.Count,
            'No matches returns empty list');
    end;

    [Test]
    procedure TestFirstRelationFieldName_NonEmpty()
    var
        FieldName: Text;
    begin
        FieldName := Walker.FirstRelationFieldName(Database::"Sales Header", Database::Customer);
        Assert.AreNotEqual('', FieldName,
            'First Customer-related field on Sales Header has a name');
    end;

    [Test]
    procedure TestFirstRelationFieldName_NoMatch()
    begin
        Assert.AreEqual('',
            Walker.FirstRelationFieldName(Database::Customer, 9999999),
            'No match returns empty');
    end;

    [Test]
    procedure TestGetNormalRelationFields_OnlyNormal()
    var
        Normal: List of [Integer];
        All: List of [Integer];
    begin
        Normal := Walker.GetNormalRelationFields(Database::"Sales Header", Database::Customer);
        All := Walker.GetAllRelationFieldNumbers(Database::"Sales Header", Database::Customer);
        Assert.IsTrue(Normal.Count <= All.Count,
            'Normal-only list cannot exceed All list');
        Assert.IsTrue(Normal.Count > 0,
            'Sales Header has at least one Normal Customer relation');
    end;

    [Test]
    procedure TestGetNormalRelationFields_Sorted()
    var
        Normal: List of [Integer];
        i: Integer;
    begin
        Normal := Walker.GetNormalRelationFields(Database::"Sales Header", Database::Customer);
        for i := 2 to Normal.Count do
            Assert.IsTrue(Normal.Get(i) > Normal.Get(i - 1),
                'Normal list ascending');
    end;

    [Test]
    procedure TestGetNormalRelationFields_Empty()
    var
        Normal: List of [Integer];
    begin
        Normal := Walker.GetNormalRelationFields(Database::Customer, 9999999);
        Assert.AreEqual(0, Normal.Count, 'No matches returns empty');
    end;

    [Test]
    procedure TestExcludeObsoleteCount_LessThanOrEqualToTotal()
    var
        Excluded: Integer;
        Total: Integer;
    begin
        Excluded := Walker.ExcludeObsoleteCount(Database::"Sales Header", Database::Customer);
        Total := Walker.CountRelationFields(Database::"Sales Header", Database::Customer);
        Assert.IsTrue(Excluded <= Total,
            'Obsolete-excluded count cannot exceed total');
        Assert.IsTrue(Excluded > 0,
            'Sales Header has at least one non-obsolete Customer relation');
    end;

    [Test]
    procedure TestExcludeObsoleteCount_NoMatch()
    begin
        Assert.AreEqual(0,
            Walker.ExcludeObsoleteCount(Database::Customer, 9999999),
            'No matches returns 0');
    end;

    [Test]
    procedure TestListSourceTablesPointingTo_Customer()
    var
        Sources: List of [Integer];
    begin
        Sources := Walker.ListSourceTablesPointingTo(Database::Customer);
        Assert.IsTrue(Sources.Count >= 5,
            'Many tables relate to Customer');
    end;

    [Test]
    procedure TestListSourceTablesPointingTo_Distinct()
    var
        Sources: List of [Integer];
        i: Integer;
    begin
        Sources := Walker.ListSourceTablesPointingTo(Database::Customer);
        for i := 2 to Sources.Count do
            Assert.IsTrue(Sources.Get(i) > Sources.Get(i - 1),
                'Source table list strictly ascending and distinct');
    end;

    [Test]
    procedure TestListSourceTablesPointingTo_Empty()
    var
        Sources: List of [Integer];
    begin
        Sources := Walker.ListSourceTablesPointingTo(9999999);
        Assert.AreEqual(0, Sources.Count, 'No relations to bogus table');
    end;
}
