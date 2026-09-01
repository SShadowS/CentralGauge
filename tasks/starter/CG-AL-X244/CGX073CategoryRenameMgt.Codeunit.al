codeunit 70383 "CG X073 Category Rename Mgt."
{
    procedure RenameCategory(OldCode: Code[20]; NewCode: Code[20])
    var
        ProductCategory: Record "CG X073 Product Category";
    begin
        if OldCode = NewCode then
            exit;

        ProductCategory.Get(OldCode);
        ProductCategory.Rename(NewCode);

        UpdateProductAssignments(OldCode, NewCode);
    end;

    local procedure UpdateProductAssignments(OldCode: Code[20]; NewCode: Code[20])
    var
        Product: Record "CG X073 Product";
    begin
        Product.SetRange("Category Code", OldCode);
        if Product.FindSet(true) then
            repeat
                Product."Category Code" := NewCode;
                Product.Modify(true);
            until Product.Next() = 0;
    end;

    procedure CreateCategory(NewCode: Code[20]; NewDescription: Text[100])
    var
        ProductCategory: Record "CG X073 Product Category";
    begin
        ProductCategory.Init();
        ProductCategory.Code := NewCode;
        ProductCategory.Description := NewDescription;
        ProductCategory.Insert(true);
    end;

    procedure AssignProduct(ProductNo: Code[20]; NewDescription: Text[100]; CategoryCode: Code[20]; UnitPrice: Decimal)
    var
        Product: Record "CG X073 Product";
    begin
        Product.Init();
        Product."No." := ProductNo;
        Product.Description := NewDescription;
        Product."Category Code" := CategoryCode;
        Product."Unit Price" := UnitPrice;
        Product.Insert(true);
    end;

    // Report filters let a saved category view stay pinned to a specific
    // category even as products move in and out of it.
    procedure CreateReportFilter(FilterCode: Code[20]; FilterDescription: Text[100]; CategoryCode: Code[20])
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
    begin
        CategoryReportFilter.Init();
        CategoryReportFilter."Filter Code" := FilterCode;
        CategoryReportFilter."Filter Description" := FilterDescription;
        CategoryReportFilter."Category Code" := CategoryCode;
        CategoryReportFilter.Enabled := true;
        CategoryReportFilter.Insert(true);
    end;

    procedure CountMatchingProducts(FilterCode: Code[20]): Integer
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        Product: Record "CG X073 Product";
    begin
        CategoryReportFilter.Get(FilterCode);
        Product.SetRange("Category Code", CategoryReportFilter."Category Code");
        exit(Product.Count());
    end;
}
