table 69960 "CG X045 Line"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Quantity; Integer)
        {
            trigger OnValidate()
            begin
                // opaque packaging rule: round UP to the next multiple of 4
                Quantity := ((Quantity + 3) div 4) * 4;
                Amount := Quantity * Price;
            end;
        }
        field(20; Price; Integer)
        {
            trigger OnValidate()
            begin
                // opaque tier rule: derives the effective price from the
                // row's CURRENT Quantity at the moment Price is validated
                if Quantity >= 10 then
                    Price := Price - 7
                else
                    Price := Price - 2;
                Amount := Quantity * Price;
            end;
        }
        field(30; Amount; Integer) { }
    }
    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
