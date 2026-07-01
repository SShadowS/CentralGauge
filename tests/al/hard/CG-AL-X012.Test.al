codeunit 80301 "CG-AL-X012 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure RenameParentCascadesToMatchingChildrenOnly()
    var
        Parent: Record "CG X012 Parent";
        Child: Record "CG X012 Child";
    begin
        // [GIVEN] A clean slate: two Parents, two Children linked to the
        // first Parent, and a third Child linked to the OTHER Parent
        Child.DeleteAll();
        Parent.DeleteAll();
        Commit();

        Parent.Init();
        Parent.Code := 'P1';
        Parent.Name := 'Parent One';
        Parent.Insert(true);

        Parent.Init();
        Parent.Code := 'OTHER';
        Parent.Name := 'Other Parent';
        Parent.Insert(true);

        Child.Init();
        Child."Entry No." := 1;
        Child."Parent Code" := 'P1';
        Child.Data := 'Alpha';
        Child.Insert(true);

        Child.Init();
        Child."Entry No." := 2;
        Child."Parent Code" := 'P1';
        Child.Data := 'Beta';
        Child.Insert(true);

        Child.Init();
        Child."Entry No." := 3;
        Child."Parent Code" := 'OTHER';
        Child.Data := 'Gamma';
        Child.Insert(true);

        Commit();

        // [WHEN] The Parent's primary key is renamed
        Parent.Get('P1');
        Parent.Rename('P2');

        // [THEN] Both Children that identified 'P1' now identify 'P2'
        Child.Get(1);
        Assert.AreEqual('P2', Child."Parent Code", 'Child 1 must follow the Parent rename');

        Child.Get(2);
        Assert.AreEqual('P2', Child."Parent Code", 'Child 2 must follow the Parent rename');

        // [THEN] The Child linked to the unrelated Parent is untouched
        Child.Get(3);
        Assert.AreEqual('OTHER', Child."Parent Code", 'Child 3 must not be affected by an unrelated Parent rename');
    end;
}
