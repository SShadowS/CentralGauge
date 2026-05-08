codeunit 80029 "CG-AL-M029 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestPrereqTableCRUD()
    var
        Rec: Record "CG Cust Prereq Table";
    begin
        Rec.Init();
        Rec."No." := 'M029-CRUD';
        Rec."Visible Field" := 'visible-value';
        Rec."Hidden Field" := 'hidden-value';
        Rec.Insert(true);

        Clear(Rec);
        Assert.IsTrue(Rec.Get('M029-CRUD'), 'Prereq table record should be retrievable by primary key');
        Assert.AreEqual('visible-value', Rec."Visible Field", 'Visible Field should round-trip');
        Assert.AreEqual('hidden-value', Rec."Hidden Field", 'Hidden Field should round-trip');

        Rec.Delete();
    end;

    [Test]
    procedure TestPrereqPageOpens()
    var
        Rec: Record "CG Cust Prereq Table";
        TestPg: TestPage "CG Cust Prereq Page";
    begin
        Rec.Init();
        Rec."No." := 'M029-PAGE';
        Rec."Visible Field" := 'on-page';
        Rec."Hidden Field" := 'off-page';
        Rec.Insert(true);

        TestPg.OpenView();
        TestPg.GoToRecord(Rec);

        Assert.AreEqual(Rec."No.", TestPg."No.".Value, 'No. should be visible on the prereq page');
        Assert.AreEqual(Rec."Visible Field", TestPg."Visible Field".Value, 'Visible Field should appear on the base page');

        TestPg.Close();

        Rec.Delete();
    end;

    [Test]
    procedure TestHiddenFieldOnlyOnTable()
    var
        Rec: Record "CG Cust Prereq Table";
    begin
        // The base page does not include Hidden Field; it only becomes visible via the
        // pagecustomization authored for this task. The pagecustomization's correctness
        // (including the v16.0 Editable property on a customization-added field) is
        // enforced by compile_pass; this test confirms the underlying field exists on
        // the prereq table so the customization has a valid source expression.
        Rec.Init();
        Rec."No." := 'M029-HIDDEN';
        Rec."Hidden Field" := 'editable-via-customization';
        Rec.Insert(true);

        Clear(Rec);
        Rec.Get('M029-HIDDEN');
        Assert.AreEqual('editable-via-customization', Rec."Hidden Field", 'Hidden Field should accept assigned values on the underlying table');

        Rec.Delete();
    end;
}
