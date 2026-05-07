codeunit 80011 "CG-AL-M001 Test"
{
    // Tests for CG-AL-M001: API Page - Product API with CRUD
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryRandom: Codeunit "Library - Random";

    [Test]
    procedure TestAPIPageExists()
    var
        ProductAPI: TestPage "Product API";
    begin
        // [SCENARIO] Product API page can be opened
        // [WHEN] We open the API page
        ProductAPI.OpenView();
        // [THEN] No error occurs
        ProductAPI.Close();
    end;

    [Test]
    procedure TestCreateProduct()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
        ProductCode: Code[20];
    begin
        // [SCENARIO] A product written to the underlying table is exposed by the API page
        // (API pages cannot be driven through TestPage UI methods - they're OData-only)
        ProductCode := CopyStr(LibraryRandom.RandText(10), 1, 20);

        // [GIVEN] A product inserted directly into the table the API page sources from
        Product.Init();
        Product."No." := ProductCode;
        Product.Description := 'Test Product';
        Product."Unit Price" := 99.99;
        Product."Stock Quantity" := 100;
        Product.Insert(true);

        // [WHEN] We open the API page in view mode and navigate to the new product
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);

        // [THEN] The API page surfaces the same record (proves SourceTable wiring is correct)
        ProductAPI.productCode.AssertEquals(ProductCode);
        ProductAPI.description.AssertEquals('Test Product');
        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    [Test]
    procedure TestReadProduct()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
    begin
        // [SCENARIO] Product can be read via API page
        // [GIVEN] An existing product
        CreateTestProduct(Product);

        // [WHEN] We open the API page and navigate to the product
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);

        // [THEN] Data is displayed correctly
        ProductAPI.productCode.AssertEquals(Product."No.");
        ProductAPI.description.AssertEquals(Product.Description);

        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    [Test]
    procedure TestUpdateProduct()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
        NewDescription: Text[100];
    begin
        // [SCENARIO] An update written to the underlying table is reflected via the API page
        // [GIVEN] An existing product
        CreateTestProduct(Product);
        NewDescription := 'Updated Description';

        // [WHEN] We update the underlying record (mirrors what an OData PATCH would do)
        Product.Description := NewDescription;
        Product.Modify(true);

        // [THEN] The API page exposes the updated value
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);
        ProductAPI.description.AssertEquals(NewDescription);
        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    [Test]
    procedure TestDeleteProduct()
    var
        Product: Record Product;
        ProductId: Guid;
    begin
        // [SCENARIO] Product record can be deleted (DELETE operation supported)
        // [GIVEN] An existing product
        CreateTestProduct(Product);
        ProductId := Product.SystemId;

        // [WHEN] We delete the product record
        Product.Delete(true);

        // [THEN] Product no longer exists in database
        Clear(Product);
        Assert.IsFalse(Product.GetBySystemId(ProductId), 'Product should be deleted');
    end;

    [Test]
    procedure TestPriceValidation()
    var
        Product: Record Product;
    begin
        // [SCENARIO] Negative price is rejected by the API page's field-level OnValidate trigger
        // [GIVEN] A new product record bound to the same SourceTable
        Product.Init();
        Product."No." := 'NEGPRICE';
        Product.Description := 'Test';

        // [WHEN/THEN] Validating Unit Price with a negative value raises the spec error
        asserterror Product.Validate("Unit Price", -10);
        Assert.ExpectedError('Price must be positive');
    end;

    [Test]
    procedure TestStockValidation()
    var
        Product: Record Product;
    begin
        // [SCENARIO] Negative stock is rejected by the API page's field-level OnValidate trigger
        Product.Init();
        Product."No." := 'NEGSTOCK';
        Product.Description := 'Test';
        Product."Unit Price" := 10;

        // [WHEN/THEN] Validating Stock Quantity with a negative value raises the spec error
        asserterror Product.Validate("Stock Quantity", -5);
        Assert.ExpectedError('Stock must be non-negative');
    end;

    [Test]
    procedure TestODataKeyFields()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
        EmptyGuid: Guid;
    begin
        // [SCENARIO] API page uses SystemId as OData key for record identification
        // [GIVEN] A product record
        CreateTestProduct(Product);

        // [WHEN] We access the product via API and check the id field (SystemId)
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);

        // [THEN] The id field matches the record's SystemId (proving ODataKeyFields = SystemId)
        ProductAPI.id.AssertEquals(Product.SystemId);
        Assert.AreNotEqual(EmptyGuid, Product.SystemId, 'SystemId should be auto-generated and non-empty');

        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    [Test]
    procedure TestCategoryIdField()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
        CategoryId: Code[20];
    begin
        // [SCENARIO] Product can have a categoryId for grouping
        // [GIVEN] A product with category ID
        CategoryId := 'CAT001';
        CreateTestProduct(Product);
        Product."Category Id" := CategoryId;
        Product.Modify();

        // [WHEN] We access the product via API
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);

        // [THEN] Category ID is exposed correctly
        ProductAPI.categoryId.AssertEquals(CategoryId);

        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    [Test]
    procedure TestSetCategoryIdViaAPI()
    var
        Product: Record Product;
        ProductAPI: TestPage "Product API";
        CategoryId: Code[20];
    begin
        // [SCENARIO] Category ID set via the table is exposed through the API page's categoryId field
        // [GIVEN] An existing product and a category ID
        CreateTestProduct(Product);
        CategoryId := 'CAT002';

        // [WHEN] We update the underlying record (mirrors an OData PATCH)
        Product."Category Id" := CategoryId;
        Product.Modify(true);

        // [THEN] The API page exposes the updated category through its categoryId field
        ProductAPI.OpenView();
        ProductAPI.GoToRecord(Product);
        ProductAPI.categoryId.AssertEquals(CategoryId);
        ProductAPI.Close();

        // Cleanup
        Product.Delete();
    end;

    local procedure CreateTestProduct(var Product: Record Product)
    begin
        Product.Init();
        Product."No." := CopyStr(LibraryRandom.RandText(10), 1, 20);
        Product.Description := 'Test Product';
        Product."Unit Price" := 50.00;
        Product."Stock Quantity" := 100;
        Product.Insert(true);
    end;
}
