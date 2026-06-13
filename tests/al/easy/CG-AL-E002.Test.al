codeunit 80002 "CG-AL-E002 Test"
{
    // Tests for CG-AL-E002: Basic Page - Product Category Card
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryRandom: Codeunit "Library - Random";

    [Test]
    procedure TestPageOpens()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
    begin
        // [SCENARIO] Product Category Card page can be opened
        // [GIVEN] A Product Category record
        CreateProductCategory(ProductCategory);

        // [WHEN] We open the page
        ProductCategoryCard.OpenView();
        ProductCategoryCard.GoToRecord(ProductCategory);

        // [THEN] The page opens without error
        ProductCategoryCard.Close();

        // Cleanup
        ProductCategory.Delete();
    end;

    [Test]
    procedure TestPageFieldsExist()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
    begin
        // [SCENARIO] All expected fields are visible on the page
        // [GIVEN] A Product Category record
        CreateProductCategory(ProductCategory);

        // [WHEN] We open the page
        ProductCategoryCard.OpenView();
        ProductCategoryCard.GoToRecord(ProductCategory);

        // [THEN] All fields are accessible (Code, Description, Active, Created Date)
        Assert.AreEqual(ProductCategory.Code, ProductCategoryCard.Code.Value, 'Code field should be visible');
        Assert.AreEqual(ProductCategory.Description, ProductCategoryCard.Description.Value, 'Description field should be visible');
        Assert.AreEqual(Format(ProductCategory.Active), ProductCategoryCard.Active.Value, 'Active field should be visible');
        // Compare actual Date values to avoid locale-dependent format differences
        Assert.AreEqual(ProductCategory."Created Date", ProductCategoryCard."Created Date".AsDate(), 'Created Date field should be visible');

        ProductCategoryCard.Close();

        // Cleanup
        ProductCategory.Delete();
    end;

    [Test]
    procedure TestPageIsEditable()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
        NewDescription: Text[100];
    begin
        // [SCENARIO] Fields can be edited on the page
        // [GIVEN] A Product Category record
        CreateProductCategory(ProductCategory);
        NewDescription := 'Updated Description';

        // [WHEN] We edit the Description field
        ProductCategoryCard.OpenEdit();
        ProductCategoryCard.GoToRecord(ProductCategory);
        ProductCategoryCard.Description.SetValue(NewDescription);
        ProductCategoryCard.Close();

        // [THEN] The change is saved
        ProductCategory.Get(ProductCategory.Code);
        Assert.AreEqual(NewDescription, ProductCategory.Description, 'Description should be updated');

        // Cleanup
        ProductCategory.Delete();
    end;

    [Test]
    procedure TestActiveFieldEditable()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
    begin
        // [SCENARIO] Active field can be toggled on the page
        // [GIVEN] A Product Category record with Active = true
        CreateProductCategory(ProductCategory);
        Assert.IsTrue(ProductCategory.Active, 'Initial Active value should be true');

        // [WHEN] We toggle Active to false
        ProductCategoryCard.OpenEdit();
        ProductCategoryCard.GoToRecord(ProductCategory);
        ProductCategoryCard.Active.SetValue(false);
        ProductCategoryCard.Close();

        // [THEN] The change is saved
        ProductCategory.Get(ProductCategory.Code);
        Assert.IsFalse(ProductCategory.Active, 'Active should be updated to false');

        // Cleanup
        ProductCategory.Delete();
    end;

    [Test]
    procedure TestCreatedDateFieldEditable()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
        NewDate: Date;
    begin
        // [SCENARIO] Created Date field can be edited on the page
        // [GIVEN] A Product Category record
        CreateProductCategory(ProductCategory);
        NewDate := LicenseSafeDate();

        // [WHEN] We change the Created Date
        ProductCategoryCard.OpenEdit();
        ProductCategoryCard.GoToRecord(ProductCategory);
        ProductCategoryCard."Created Date".SetValue(NewDate);
        ProductCategoryCard.Close();

        // [THEN] The change is saved
        ProductCategory.Get(ProductCategory.Code);
        Assert.AreEqual(NewDate, ProductCategory."Created Date", 'Created Date should be updated');

        // Cleanup
        ProductCategory.Delete();
    end;

    [Test]
    procedure TestNewRecordFromPage()
    var
        ProductCategory: Record "Product Category";
        ProductCategoryCard: TestPage "Product Category Card";
        TestCode: Code[20];
        TestDate: Date;
    begin
        // [SCENARIO] New record can be created from page with all fields
        // [GIVEN] A new code and test data
        TestCode := CopyStr(LibraryRandom.RandText(10), 1, 20);
        TestDate := LicenseSafeDate();

        // [WHEN] We create a new record via the page with all fields
        ProductCategoryCard.OpenNew();
        ProductCategoryCard.Code.SetValue(TestCode);
        ProductCategoryCard.Description.SetValue('New Category');
        ProductCategoryCard.Active.SetValue(true);
        ProductCategoryCard."Created Date".SetValue(TestDate);
        ProductCategoryCard.Close();

        // [THEN] The record exists with all field values
        Assert.IsTrue(ProductCategory.Get(TestCode), 'Record should be created');
        Assert.AreEqual('New Category', ProductCategory.Description, 'Description should match');
        Assert.IsTrue(ProductCategory.Active, 'Active should be true');
        Assert.AreEqual(TestDate, ProductCategory."Created Date", 'Created Date should match');

        // Cleanup
        ProductCategory.Delete();
    end;

    local procedure CreateProductCategory(var ProductCategory: Record "Product Category")
    begin
        ProductCategory.Init();
        ProductCategory.Code := CopyStr(LibraryRandom.RandText(10), 1, 20);
        ProductCategory.Description := 'Test Category';
        ProductCategory.Active := true;
        ProductCategory."Created Date" := WorkDate();
        ProductCategory.Insert(true);
    end;

    local procedure LicenseSafeDate(): Date
    begin
        // The Cronus demo license restricts dates entered through the client to
        // the Nov-Feb window (filter '??11*|??12*|??01*|??02*'). A date set
        // through a TestPage outside that window is rejected by the client-layer
        // license check, so date-editing assertions must use an in-window date
        // to stay portable across container licenses (GH #13). 15 January of the
        // work-date year is always in-window.
        exit(DMY2Date(15, 1, Date2DMY(WorkDate(), 3)));
    end;
}
