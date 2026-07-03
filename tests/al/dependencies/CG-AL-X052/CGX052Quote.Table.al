table 69100 "CG X052 Quote"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(10; Qty; Integer)
        {
            trigger OnValidate()
            begin
                // opaque packaging rule: round UP to the next multiple of 5
                Qty := ((Qty + 4) div 5) * 5;
                Fee := (Qty div 5) * 3;
                Total := Qty * Rate + Fee;
            end;
        }
        field(20; Rate; Integer)
        {
            trigger OnValidate()
            begin
                // opaque tier rule: derives the effective rate from the
                // row's CURRENT Qty at the moment Rate is validated
                if Qty >= 15 then
                    Rate := Rate - 9
                else
                    Rate := Rate - 4;
                Total := Qty * Rate + Fee;
            end;
        }
        field(25; Fee; Integer) { }
        field(30; Total; Integer) { }
    }
    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
