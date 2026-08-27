table 70200 "CG Warehouse"
{
    Caption = 'CG Warehouse';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10])
        {
            Caption = 'Code';
            DataClassification = CustomerContent;
        }
        field(2; Name; Text[50])
        {
            Caption = 'Name';
            DataClassification = CustomerContent;
        }
        field(3; "Total Inventory Qty"; Decimal)
        {
            Caption = 'Total Inventory Qty';
            FieldClass = FlowField;
            CalcFormula = sum("CG Warehouse Entry".Quantity where("Warehouse Code" = field(Code)));
            Editable = false;
        }
        field(4; "Entry Count"; Integer)
        {
            Caption = 'Entry Count';
            FieldClass = FlowField;
            CalcFormula = count("CG Warehouse Entry" where("Warehouse Code" = field(Code)));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}

table 70201 "CG Warehouse Entry"
{
    Caption = 'CG Warehouse Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            DataClassification = CustomerContent;
            AutoIncrement = true;
        }
        field(2; "Warehouse Code"; Code[10])
        {
            Caption = 'Warehouse Code';
            DataClassification = CustomerContent;
            TableRelation = "CG Warehouse".Code;
        }
        field(3; "Item No."; Code[20])
        {
            Caption = 'Item No.';
            DataClassification = CustomerContent;
        }
        field(4; Quantity; Decimal)
        {
            Caption = 'Quantity';
            DataClassification = CustomerContent;
        }
        field(5; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(WarehouseCode; "Warehouse Code")
        {
            SumIndexFields = Quantity;
        }
    }
}