codeunit 80037 "CG-AL-M037 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestExtBizEventCodeunitObjectIdResolves()
    begin
        // Compile_pass validates: ExternalBusinessEvent attribute (5 positional parameters),
        // Obsolete attribute combinable with ExternalBusinessEvent on the same procedure,
        // and the same-EventName-different-Version coexistence pattern that lets external
        // subscribers see the v1.0 obsolete event alongside the v2.0 replacement.
        Assert.AreEqual(70037, Codeunit::"CG ExtBizEvent Demo", 'ExtBizEvent demo codeunit should compile and resolve to ID 70037');
    end;

    [Test]
    procedure TestEventCategoryEnumValues()
    var
        Cat: Enum "CG Demo Event Category";
    begin
        Cat := Enum::"CG Demo Event Category"::Uncategorized;
        Assert.AreEqual(0, Cat.AsInteger(), 'Uncategorized should be ordinal 0');

        Cat := Enum::"CG Demo Event Category"::Sales;
        Assert.AreEqual(1, Cat.AsInteger(), 'Sales should be ordinal 1');
    end;
}
