codeunit 88826 "CG-AL-X073 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears every table this scenario touches before seeding
    // its own rows.

    local procedure ClearAll()
    var
        ProductCategory: Record "CG X073 Product Category";
        Product: Record "CG X073 Product";
        CategoryReportFilter: Record "CG X073 Category Report Filter";
    begin
        ProductCategory.DeleteAll();
        Product.DeleteAll();
        CategoryReportFilter.DeleteAll();
    end;

    local procedure SetFilterEnabled(FilterCode: Code[20]; NewEnabled: Boolean)
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
    begin
        CategoryReportFilter.Get(FilterCode);
        CategoryReportFilter.Enabled := NewEnabled;
        CategoryReportFilter.Modify();
    end;

    [Test]
    procedure RenamedCategoryCodeReachesItsOwnReportFilter()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILT1');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'The report filter must point at the category''s current code after a rename');
        Assert.AreEqual('Category Summary', CategoryReportFilter."Filter Description", 'The filter''s own description must not change when its category is renamed');
    end;

    [Test]
    procedure MatchingProductCountReflectsRenamedCategory()
    var
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P003', 'Gizmo', 'OLDCAT', 3.1);
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.AreEqual(3, RenameMgt.CountMatchingProducts('FILT1'), 'A report filter for the category must still count all its products after the category is renamed');
    end;

    [Test]
    procedure UnrelatedReportFilterKeepsItsOwnCategoryCode()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('SIDECAT', 'Side Category');
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');
        RenameMgt.CreateReportFilter('FILTSIDE', 'Side Summary', 'SIDECAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILTSIDE');
        Assert.AreEqual('SIDECAT', CategoryReportFilter."Category Code", 'A report filter for a different category must not be touched by an unrelated rename');
        Assert.AreEqual('Side Summary', CategoryReportFilter."Filter Description", 'An unrelated filter''s description must stay exactly as it was');
    end;

    [Test]
    procedure EveryReportFilterOnTheRenamedCategoryUpdates()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateReportFilter('FILTA', 'Filter A', 'OLDCAT');
        RenameMgt.CreateReportFilter('FILTB', 'Filter B', 'OLDCAT');
        SetFilterEnabled('FILTB', false);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILTA');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'Filter A must follow the category rename');
        Assert.IsTrue(CategoryReportFilter.Enabled, 'Filter A''s own enabled state must not change from the rename');

        CategoryReportFilter.Get('FILTB');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'Filter B must follow the category rename');
        Assert.IsFalse(CategoryReportFilter.Enabled, 'Filter B''s own enabled state must not change from the rename');
    end;

    [Test]
    procedure ProductAssignmentsStillFollowARenamedCategory()
    var
        Product: Record "CG X073 Product";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('SIDECAT', 'Side Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P900', 'Untouched Item', 'SIDECAT', 999.99);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Product.Get('P001');
        Assert.AreEqual('NEWCAT', Product."Category Code", 'A product in the renamed category must carry the new code');
        Product.Get('P002');
        Assert.AreEqual('NEWCAT', Product."Category Code", 'Every product in the renamed category must carry the new code');
        Product.Get('P900');
        Assert.AreEqual('SIDECAT', Product."Category Code", 'A product in a different category must keep its own code');
        Assert.AreEqual(999.99, Product."Unit Price", 'A product outside the renamed category must be left completely untouched');
    end;

    [Test]
    procedure RenamingACategoryWithNoReportFiltersDoesNotCreateOne()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.IsFalse(CategoryReportFilter.FindFirst(), 'No report filter existed for this category, so a rename must not create one');
    end;

    [Test]
    procedure RenameActuallyRenamesTheCategoryRecordItself()
    var
        ProductCategory: Record "CG X073 Product Category";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.IsTrue(ProductCategory.Get('NEWCAT'), 'The category record itself must exist under its new code after a rename');
        Assert.AreEqual('Old Category', ProductCategory.Description, 'The category''s own description must survive the rename');
        Assert.IsFalse(ProductCategory.Get('OLDCAT'), 'The category record must no longer exist under its old code after a rename');
    end;

    [Test]
    procedure CountMatchingProductsExcludesProductsInAnUnrelatedCategory()
    var
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('OTHERCAT', 'Other Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P900', 'Unrelated Item', 'OTHERCAT', 50);
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        Assert.AreEqual(2, RenameMgt.CountMatchingProducts('FILT1'),
          'A report filter must count only products in its own category, not every product in the company');
    end;
}
