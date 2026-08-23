table 70362 "CG X071 Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Document Type"; Enum "CG X071 Order Doc Type")
        {
            DataClassification = CustomerContent;
        }
        field(3; "Sell-to Customer No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(4; "Bill-to Customer No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(5; Status; Enum "CG X071 Order Status")
        {
            DataClassification = CustomerContent;
        }
        field(60; Amount; Decimal)
        {
            Caption = 'Amount';
            FieldClass = FlowField;
            CalcFormula = sum("CG X071 Order Line".Amount where("Order No." = field("No.")));
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
