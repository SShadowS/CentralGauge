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
