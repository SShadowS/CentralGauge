codeunit 89367 "CG-AL-X147 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        AttrDefault: Record "CG X147 Attribute Default";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        AttrDefault.DeleteAll();
        AssignmentEntry.DeleteAll();
    end;

    local procedure SeedEntityValue(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetEntityValue(EntityType, EntityNo, AttributeCode, NewValue);
    end;

    local procedure SeedTypeValue(EntityType: Enum "CG X147 Entity Type"; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetTypeValue(EntityType, AttributeCode, NewValue);
    end;

    local procedure AssertResolvesTo(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; ExpectedValue: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual(ExpectedValue, Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsTrue(AssignmentEntry.FindFirst(), MessagePrefix + ' - assignment recorded');
        Assert.AreEqual(ExpectedValue, AssignmentEntry."Resolved Value", MessagePrefix + ' - assignment value');
    end;

    local procedure AssertResolvesToNothing(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual('', Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsFalse(AssignmentEntry.FindFirst(), MessagePrefix + ' - no assignment recorded');
    end;

    [Test]
    procedure EntityWithItsOwnValueResolvesToIt()
    begin
        ClearAll();
        SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD');

        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD', 'An entity with its own value for an attribute resolves to it');
    end;

    [Test]
    procedure EntityRelyingOnTheStandardValueForItsTypeResolvesToIt()
    begin
        ClearAll();
        SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');

        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST2', 'TIER', 'STANDARD', 'An entity with no value of its own resolves to the standard value set for its type');
    end;

    [Test]
    procedure EntityWithItsOwnValueIsUnaffectedByItsTypesStandardValue()
    begin
        ClearAll();
        SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');
        SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM');

        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM', 'An entity with its own value resolves to it even when a standard value exists for its type');
    end;

    [Test]
    procedure EntityWithNeitherItsOwnNorAStandardValueResolvesToNothing()
    begin
        ClearAll();

        AssertResolvesToNothing("CG X147 Entity Type"::Customer, 'CUST4', 'TIER', 'An entity with no value of its own and no standard value for its type resolves to nothing');
    end;

    [Test]
    procedure EntityDoesNotInheritAnotherTypesStandardValue()
    begin
        ClearAll();
        SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');

        AssertResolvesToNothing("CG X147 Entity Type"::Vendor, 'VEND1', 'TIER', 'An entity does not resolve to a standard value set for a different entity type');
    end;

    [Test]
    procedure TwoAttributesOnTheSameTypeResolveIndependently()
    begin
        ClearAll();
        SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-TIER');
        SeedTypeValue("CG X147 Entity Type"::Customer, 'REGION', 'STANDARD-REGION');

        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'TIER', 'STANDARD-TIER', 'An entity resolves the standard value for one attribute');
        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'REGION', 'STANDARD-REGION', 'An entity resolves the standard value for a different attribute independently');
    end;

    [Test]
    procedure SeveralEntitiesEachResolveTheirOwnCase()
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        ClearAll();
        SeedEntityValue("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER', 'SENT-VAL');
        SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');
        SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C');
        SeedTypeValue("CG X147 Entity Type"::Vendor, 'TIER', 'STANDARD-V');

        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST7', 'TIER', 'STANDARD-C', 'A customer with no value of its own resolves to its type''s standard value');
        AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C', 'A customer with its own value resolves to it, not to its type''s standard value');
        AssertResolvesTo("CG X147 Entity Type"::Vendor, 'VEND2', 'TIER', 'STANDARD-V', 'A vendor with no value of its own resolves to its own type''s standard value, not the customer''s');

        Assert.IsTrue(AttrDefault.Get("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER'), 'An unrelated entity''s own value must survive');
        Assert.AreEqual('SENT-VAL', AttrDefault.Value, 'An unrelated entity''s own value must be unchanged');
    end;
}
