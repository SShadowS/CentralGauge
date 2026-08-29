table 71560 "CG X172 Production Order"
{
    Caption = 'CG X172 Production Order';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Order Description"; Text[100])
        {
            Caption = 'Order Description';
        }
        field(3; "Total Units"; Integer)
        {
            Caption = 'Total Units';
            MinValue = 0;
        }
        field(4; Allocated; Boolean)
        {
            Caption = 'Allocated';
            Editable = false;
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
