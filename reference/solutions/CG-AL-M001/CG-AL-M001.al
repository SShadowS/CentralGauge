tableextension 70101 "Product Validation" extends Product
{
    fields
    {
        modify("Unit Price")
        {
            trigger OnAfterValidate()
            begin
                if "Unit Price" < 0 then
                    Error('Price must be positive');
            end;
        }
        modify("Stock Quantity")
        {
            trigger OnAfterValidate()
            begin
                if "Stock Quantity" < 0 then
                    Error('Stock must be non-negative');
            end;
        }
    }
}

page 70100 "Product API"
{
    PageType = API;
    Caption = 'Product API';
    APIPublisher = 'mycompany';
    APIGroup = 'products';
    APIVersion = 'v1.0';
    EntityName = 'product';
    EntitySetName = 'products';
    SourceTable = Product;
    DelayedInsert = true;
    ODataKeyFields = SystemId;
    InsertAllowed = true;
    ModifyAllowed = true;
    DeleteAllowed = true;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'id';
                    Editable = false;
                }
                field(productCode; Rec."No.")
                {
                    Caption = 'productCode';
                }
                field(description; Rec.Description)
                {
                    Caption = 'description';
                }
                field(unitPrice; Rec."Unit Price")
                {
                    Caption = 'unitPrice';
                }
                field(stockQuantity; Rec."Stock Quantity")
                {
                    Caption = 'stockQuantity';
                }
                field(categoryId; Rec."Category Id")
                {
                    Caption = 'categoryId';
                }
            }
        }
    }

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    begin
        Rec.Insert(true);
        exit(false);
    end;

    trigger OnModifyRecord(): Boolean
    begin
        Rec.Modify(true);
        exit(false);
    end;

    trigger OnDeleteRecord(): Boolean
    begin
        Rec.Delete(true);
        exit(false);
    end;
}