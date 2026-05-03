table 69001 "Product"
{
    Caption = 'Product';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            NotBlank = true;
        }
        field(2; "Description"; Text[100])
        {
            Caption = 'Description';
        }
        field(3; "Unit Price"; Decimal)
        {
            Caption = 'Unit Price';
        }
        field(4; "Stock Quantity"; Decimal)
        {
            Caption = 'Stock Quantity';
        }
        field(5; "Category Id"; Code[20])
        {
            Caption = 'Category Id';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
